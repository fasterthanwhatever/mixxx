#include "engine/bufferscalers/enginebufferscalest.h"

#include "moc_enginebufferscalest.cpp"

// Fixes redefinition warnings from SoundTouch.
#include <soundtouch/SoundTouch.h>

#include "control/controlobject.h"
#include "engine/engineobject.h"
#include "engine/readaheadmanager.h"
#include "track/keyutils.h"
#include "util/math.h"
#include "util/sample.h"

using namespace soundtouch;

namespace {

// Due to filtering and oversampling, SoundTouch is some samples behind.
// The value below was experimental identified using a saw signal and SoundTouch 1.8
// at a speed of 1.0
// 0.918 (upscaling 44.1 kHz to 48 kHz) will produce an additional offset of 3 Frames
// 0.459 (upscaling 44.1 kHz to 96 kHz) will produce an additional offset of 18 Frames
// (Rubberband does not suffer this issue)
constexpr SINT kSeekOffsetFrames = 519;

}  // namespace

EngineBufferScaleST::EngineBufferScaleST(ReadAheadManager *pReadAheadManager)
    : m_pReadAheadManager(pReadAheadManager),
      m_pSoundTouch(std::make_unique<soundtouch::SoundTouch>()),
      m_bBackwards(false) {
    m_pSoundTouch->setChannels(getOutputSignal().getChannelCount());
    m_pSoundTouch->setRate(m_dBaseRate);
    m_pSoundTouch->setPitch(1.0);
    m_pSoundTouch->setSetting(SETTING_USE_QUICKSEEK, 1);
    // Initialize the internal buffers to prevent re-allocations
    // in the real-time thread.
    onSampleRateChanged();

}

EngineBufferScaleST::~EngineBufferScaleST() {
}

void EngineBufferScaleST::setScaleParameters(double base_rate,
                                             double* pTempoRatio,
                                             double* pPitchRatio) {

    // Negative speed means we are going backwards. pitch does not affect
    // the playback direction.
    m_bBackwards = *pTempoRatio < 0;

    // It's an error to pass a rate or tempo smaller than MIN_SEEK_SPEED to
    // SoundTouch (see definition of MIN_SEEK_SPEED for more details).
    double speed_abs = fabs(*pTempoRatio);
    if (speed_abs > MAX_SEEK_SPEED) {
        speed_abs = MAX_SEEK_SPEED;
    } else if (speed_abs < MIN_SEEK_SPEED) {
        speed_abs = 0;
    }

    // Let the caller know if we clamped their value.
    *pTempoRatio = m_bBackwards ? -speed_abs : speed_abs;

    // Include baserate in rate_abs so that we do samplerate conversion as part
    // of rate adjustment.
    if (speed_abs != m_dTempoRatio) {
        // Note: A rate of zero would make Soundtouch crash,
        // this is caught in scaleBuffer()
        m_pSoundTouch->setTempo(speed_abs);
        m_dTempoRatio = speed_abs;
    }
    if (base_rate != m_dBaseRate) {
        m_pSoundTouch->setRate(base_rate);
        m_dBaseRate = base_rate;
    }

    if (*pPitchRatio != m_dPitchRatio) {
        // Note: pitch ratio must be positive
        double pitch = fabs(*pPitchRatio);
        if (pitch > 0.0) {
            m_pSoundTouch->setPitch(pitch);
        }
        m_dPitchRatio = *pPitchRatio;
    }

    // NOTE(rryan) : There used to be logic here that clear()'d when the player
    // changed direction. I removed it because this is handled by EngineBuffer.
}

void EngineBufferScaleST::onSampleRateChanged() {
    buffer_back.clear();
    if (!getOutputSignal().isValid()) {
        return;
    }
    m_pSoundTouch->setSampleRate(getOutputSignal().getSampleRate());
    const auto bufferSize = getOutputSignal().frames2samples(kSeekOffsetFrames);
    if (bufferSize > buffer_back.size()) {
        // grow buffer
        buffer_back = mixxx::SampleBuffer(bufferSize);
    }
    // Setting the tempo to a very low value will force SoundTouch
    // to preallocate buffers large enough to (almost certainly)
    // avoid memory reallocations during playback.
    m_pSoundTouch->setTempo(0.1);
    m_pSoundTouch->putSamples(buffer_back.data(), kSeekOffsetFrames);
    m_pSoundTouch->clear();
    m_pSoundTouch->setTempo(m_dTempoRatio);
}

void EngineBufferScaleST::clear() {
    m_pSoundTouch->clear();

    // compensate seek offset for a rate of 1.0
    SampleUtil::clear(buffer_back.data(), buffer_back.size());
    m_pSoundTouch->putSamples(buffer_back.data(), kSeekOffsetFrames);
}

double EngineBufferScaleST::scaleBuffer(
        CSAMPLE* pOutputBuffer,
        SINT iOutputBufferSize) {
    if (m_dBaseRate == 0.0 || m_dTempoRatio == 0.0 || m_dPitchRatio == 0.0) {
        SampleUtil::clear(pOutputBuffer, iOutputBufferSize);
        // No actual samples/frames have been read from the
        // unscaled input buffer!
        return 0.0;
    }

    SINT total_received_frames = 0;

    SINT remaining_frames = getOutputSignal().samples2frames(iOutputBufferSize);
    CSAMPLE* read = pOutputBuffer;
    bool last_read_failed = false;
    while (remaining_frames > 0) {
        SINT received_frames = m_pSoundTouch->receiveSamples(
                read, remaining_frames);
        DEBUG_ASSERT(remaining_frames >= received_frames);
        remaining_frames -= received_frames;
        total_received_frames += received_frames;
        read += getOutputSignal().frames2samples(received_frames);

        if (remaining_frames > 0) {
            SINT iAvailSamples = m_pReadAheadManager->getNextSamples(
                        // The value doesn't matter here. All that matters is we
                        // are going forward or backward.
                        (m_bBackwards ? -1.0 : 1.0) * m_dBaseRate * m_dTempoRatio,
                        buffer_back.data(),
                        buffer_back.size());
            SINT iAvailFrames = getOutputSignal().samples2frames(iAvailSamples);

            if (iAvailFrames > 0) {
                last_read_failed = false;
                m_pSoundTouch->putSamples(buffer_back.data(), iAvailFrames);
            } else {
                // We may get 0 samples once if we just hit a loop trigger, e.g.
                // when reloop_toggle jumps back to loop_in, or when moving a
                // loop causes the play position to be moved along.
                if (last_read_failed) {
                    // If we get 0 samples repeatedly, add silence that allows
                    // to flush the last samples out of Soundtouch.
                    // m_pSoundTouch->flush() must not be used, because it allocates
                    // a temporary buffer in the heap which maybe locking
                    qDebug() << "ReadAheadManager::getNextSamples() returned "
                                "zero samples repeatedly. Padding with silence.";
                    SampleUtil::clear(buffer_back.data(), buffer_back.size());
                    m_pSoundTouch->putSamples(buffer_back.data(), buffer_back.size());
                }
                last_read_failed = true;
            }
        }
    }

    // framesRead is interpreted as the total number of virtual sample frames
    // consumed to produce the scaled buffer. Due to this, we do not take into
    // account directionality or starting point.
    // NOTE(rryan): Why no m_dPitchAdjust here? SoundTouch implements pitch
    // shifting as a tempo shift of (1/m_dPitchAdjust) and a rate shift of
    // (*m_dPitchAdjust) so these two cancel out.
    double framesRead = m_dBaseRate * m_dTempoRatio * total_received_frames;

    return framesRead;
}
