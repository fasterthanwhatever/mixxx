// dim all lights when inactive instead of turning them off
components.Button.prototype.off = 0x01;

var MixtrackProFX = {};

// pitch ranges
// add/remove/modify steps to your liking
// default step must be set in Mixxx settings
// setting is stored per deck in pitchRange.currentRangeIdx
MixtrackProFX.pitchRanges = [0.08, 0.16, 1];

// whether the corresponding Mixxx option is enabled
// (Settings -> Preferences -> Waveforms -> Synchronize zoom level across all waveforms)
MixtrackProFX.waveformsSynced = true;

// jogwheel
MixtrackProFX.jogScratchSensitivity = 1024;
MixtrackProFX.jogScratchAlpha = 1; // do NOT set to 2 or higher
MixtrackProFX.jogScratchBeta = 1/32;
MixtrackProFX.jogPitchSensitivity = 10;
MixtrackProFX.jogSeekSensitivity = 10000;

// blink settings
MixtrackProFX.enableBlink = true;
MixtrackProFX.blinkDelay = 700;

// autoloop sizes, for available values see:
// https://manual.mixxx.org/2.3/en/chapters/appendix/mixxx_controls.html#control-[ChannelN]-beatloop_X_toggle
MixtrackProFX.autoLoopSizes = [
    "0.0625",
    "0.125",
    "0.25",
    "0.5",
    "1",
    "2",
    "4",
    "8"
];

// beatjump values, for available values see:
// https://manual.mixxx.org/2.3/en/chapters/appendix/mixxx_controls.html#control-[ChannelN]-beatjump_X_forward
// underscores (_) at the end are needed because numeric values (e.g. 8) have two underscores (e.g. beatjump_8_forward),
// but "beatjump_forward"/"beatjump_backward" have only one underscore
MixtrackProFX.beatJumpValues = [
    "0.0625_",
    "0.125_",
    "0.25_",
    "0.5_",
    "1_",
    "2_",
    "", // "beatjump_forward"/"beatjump_backward" - jump by the value selected in Mixxx GUI (4 by default)
    "8_"
];

// pad modes, don't touch
MixtrackProFX.PadModeControls = {
    HOTCUE: 0x00,
    AUTOLOOP: 0x0D,
    FADERCUTS: 0x07,
    SAMPLE1: 0x0B,
    BEATJUMP: 0x02,
    SAMPLE2: 0x0F
};

// state variables, don't touch
MixtrackProFX.shifted = false;

MixtrackProFX.init = function() {
    // initialize component containers
    MixtrackProFX.deck = new components.ComponentContainer();
    MixtrackProFX.effect = new components.ComponentContainer();
    var i;
    for (i = 0; i < 2; i++) {
        MixtrackProFX.deck[i] = new MixtrackProFX.Deck(i + 1);
        MixtrackProFX.effect[i] = new MixtrackProFX.EffectUnit(i + 1);
    }

    MixtrackProFX.browse = new MixtrackProFX.Browse();
    MixtrackProFX.gains = new MixtrackProFX.Gains();

    // send sysexes
    var exitDemoSysex = [0xF0, 0x7E, 0x00, 0x06, 0x01, 0xF7];
    midi.sendSysexMsg(exitDemoSysex, exitDemoSysex.length);

    var statusSysex = [0xF0, 0x00, 0x20, 0x7F, 0x03, 0x01, 0xF7];
    midi.sendSysexMsg(statusSysex, statusSysex.length);

    // enables 4 bottom pads "fader cuts"
    var faderCutSysex = [0xF0, 0x00, 0x20, 0x7F, 0x03, 0xF7];
    midi.sendSysexMsg(faderCutSysex, faderCutSysex.length);

    // initialize leds
    for (i = 0; i < 2; i++) {
        midi.sendShortMsg(0x94 + i, 0x00, 0x7F); // hotcue
        midi.sendShortMsg(0x94 + i, 0x0D, 0x01); // auto loop
        midi.sendShortMsg(0x94 + i, 0x07, 0x01); // "fader cuts"
        midi.sendShortMsg(0x94 + i, 0x0B, 0x01); // sample1

        // shifted leds
        midi.sendShortMsg(0x94 + i, 0x0F, 0x01); // sample2
        midi.sendShortMsg(0x94 + i, 0x02, 0x01); // beatjump
    }

    engine.makeConnection("[Channel1]", "VuMeter", MixtrackProFX.vuCallback);
    engine.makeConnection("[Channel2]", "VuMeter", MixtrackProFX.vuCallback);

    // trigger is needed to initialize lights to 0x01
    MixtrackProFX.deck.forEachComponent(function(component) {
        component.trigger();
    });
    MixtrackProFX.effect.forEachComponent(function(component) {
        component.trigger();
    });
};

MixtrackProFX.shutdown = function() {
    var shutdownSysex = [0xF0, 0x00, 0x20, 0x7F, 0x02, 0xF7];
    midi.sendSysexMsg(shutdownSysex, shutdownSysex.length);
};

MixtrackProFX.shift = function() {
    MixtrackProFX.shifted = true;
    MixtrackProFX.deck.shift();
    MixtrackProFX.browse.shift();
    MixtrackProFX.effect.shift();
};

MixtrackProFX.unshift = function() {
    MixtrackProFX.shifted = false;
    MixtrackProFX.deck.unshift();
    MixtrackProFX.browse.unshift();
    MixtrackProFX.effect.unshift();
};

// TODO in 2.3 it is not possible to "properly" map the FX selection buttons.
// this should be done with load_preset and QuickEffects instead (when effect
// chain preset saving/loading is available in Mixxx)
MixtrackProFX.EffectUnit = function(deckNumber) {
    this.group = "[EffectRack1_EffectUnit" + deckNumber + "]";

    // switch values are:
    // 0 - switch in the middle
    // 1 - switch up
    // 2 - switch down
    this.enableSwitch = new components.Button({
        group: "[EffectRack1_EffectUnit" + deckNumber + "_Effect1]",
        inKey: "enabled"
    });

    this.dryWetKnob = new components.Pot({
        group: this.group,
        inKey: "mix"
    });

    this.tap = new components.Button({
        group: "[Channel" + deckNumber + "]",
        key: "bpm_tap",
        midi: [0x88, 0x09]
    });

    this.effectParam = new components.Encoder({
        group: "[EffectRack1_EffectUnit" + deckNumber + "_Effect1]",
        shift: function() {
            this.inKey = "parameter2";
        },
        unshift: function() {
            this.inKey = "parameter1";
        },
        input: function(channel, control, value) {
            this.inSetParameter(this.inGetParameter() + this.inValueScale(value));
        },
        inValueScale: function(value) {
            return (value < 0x40) ? 0.05 : -0.05;
        }
    });

    this.prevEffect = new components.Button({
        group: "[EffectRack1_EffectUnit" + deckNumber + "_Effect1]",
        midi: [0x98, (deckNumber - 1) * 2],
        shift: function() {
            this.group = "[Channel" + deckNumber + "]";
            this.inKey = "pitch_up";
            this.outKey = "pitch_up";
            this.disconnect();
            this.connect();
        },
        unshift: function() {
            this.group = "[EffectRack1_EffectUnit" + deckNumber + "_Effect1]";
            this.inKey = "prev_effect";
            this.outKey = "prev_effect";
            this.disconnect();
            this.connect();
        }
    });

    this.nextEffect = new components.Button({
        group: "[EffectRack1_EffectUnit" + deckNumber + "_Effect1]",
        midi: [0x99, 0x03 + (deckNumber - 1) * 2],
        shift: function() {
            this.group = "[Channel" + deckNumber + "]";
            this.inKey = "pitch_down";
            this.outKey = "pitch_down";
            this.disconnect();
            this.connect();
        },
        unshift: function() {
            this.group = "[EffectRack1_EffectUnit" + deckNumber + "_Effect1]";
            this.inKey = "next_effect";
            this.outKey = "next_effect";
            this.disconnect();
            this.connect();
        }
    });
};

MixtrackProFX.EffectUnit.prototype = new components.ComponentContainer();

MixtrackProFX.Deck = function(number) {
    components.Deck.call(this, number);

    var channel = number - 1;
    var deck = this;
    this.scratchModeEnabled = true;

    this.playButton = new components.PlayButton({
        midi: [0x90 + channel, 0x00],
        shiftControl: true,
        sendShifted: true,
        shiftOffset: 0x04
    });

    this.cueButton = new components.CueButton({
        midi: [0x90 + channel, 0x01],
        shiftControl: true,
        sendShifted: true,
        shiftOffset: 0x04
    });

    this.syncButton = new components.SyncButton({
        midi: [0x90 + channel, 0x02],
        shiftControl: true,
        sendShifted: true,
        shiftOffset: 0x01
    });

    this.pflButton = new components.Button({
        type: components.Button.prototype.types.toggle,
        midi: [0x90 + channel, 0x1B],
        key: "pfl"
    });

    this.loadButton = new components.Button({
        inKey: "LoadSelectedTrack"
    });

    this.volume = new components.Pot({
        group: this.currentDeck,
        inKey: "volume"
    });

    this.treble = new components.Pot({
        group: "[EqualizerRack1_" + this.currentDeck + "_Effect1]",
        inKey: "parameter3"
    });

    this.mid = new components.Pot({
        group: "[EqualizerRack1_" + this.currentDeck + "_Effect1]",
        inKey: "parameter2"
    });

    this.bass = new components.Pot({
        group: "[EqualizerRack1_" + this.currentDeck + "_Effect1]",
        inKey: "parameter1"
    });

    this.filter = new components.Pot({
        group: "[QuickEffectRack1_" + this.currentDeck + "]",
        inKey: "super1"
    });

    this.gain = new components.Pot({
        inKey: "pregain"
    });

    this.pitch = new components.Pot({
        inKey: "rate",
        invert: true
    });

    this.padSection = new MixtrackProFX.PadSection(number);

    this.shiftButton = new components.Button({
        input: function(channel, control, value) {
            // each shift button shifts the entire controller.
            // more consistent with the logic burned into hardware
            if (this.isPress(channel, control, value)) {
                MixtrackProFX.shift();
            } else {
                MixtrackProFX.unshift();
            }
        },
    });

    this.loop = new components.Button({
        outKey: "loop_enabled",
        midi: [0x94 + channel, 0x40],
        shift: function() {
            this.inKey = "loop_in_goto";
            this.input = components.Button.prototype.input;
        },
        unshift: function() {
            this.input = function(channel, control, value, status, group) {
                if (value !== 0x7F) {
                    return;
                }
                if (engine.getValue(group, "loop_enabled") === 0) {
                    script.triggerControl(group, "beatloop_activate");
                } else {
                    script.triggerControl(group, "beatlooproll_activate");
                }
            };
        },
        shiftControl: true,
        sendShifted: true,
        shiftOffset: 0x01
    });

    this.loopHalf = new components.Button({
        midi: [0x94 + channel, 0x34],
        shiftControl: true,
        sendShifted: true,
        shiftOffset: 0x02,
        shift: function() {
            this.inKey = "loop_in";
            this.outKey = "loop_in";
            this.disconnect();
            this.connect();
        },
        unshift: function() {
            this.inKey = "loop_halve";
            this.outKey = "loop_halve";
            this.disconnect();
            this.connect();
        }
    });

    this.loopDouble = new components.Button({
        midi: [0x94 + channel, 0x35],
        shiftControl: true,
        sendShifted: true,
        shiftOffset: 0x02,
        shift: function() {
            this.inKey = "loop_out";
            this.outKey = "loop_out";
            this.disconnect();
            this.connect();
        },
        unshift: function() {
            this.inKey = "loop_double";
            this.outKey = "loop_double";
            this.disconnect();
            this.connect();
        }
    });

    this.scratchToggle = new components.Button({
        midi: [0x90 + channel, 0x07],
        shift: function() {
            this.inKey = "reverseroll";
            this.outKey = "reverseroll";
            this.connect();
            this.input = components.Button.prototype.input;
        },
        unshift: function() {
            this.disconnect();
            this.input = function(channel, control, value) {
                if (value !== 0x7F) {
                    return;
                }
                deck.scratchModeEnabled = !deck.scratchModeEnabled;
                midi.sendShortMsg(this.midi[0], this.midi[1], deck.scratchModeEnabled ? 0x7F : 0x01);
            };

            midi.sendShortMsg(this.midi[0], this.midi[1], deck.scratchModeEnabled ? 0x7F : 0x01);

            var bleepEnabled = engine.getParameter(this.group, "reverseroll") === 1;
            midi.sendShortMsg(this.midi[0], this.midi[1] + this.shiftOffset, bleepEnabled ? 0x7F : 0x01);
        },
        shiftControl: true,
        sendShifted: true,
        shiftOffset: 0x01
    });

    this.pitchBendUp = new components.Button({
        shiftControl: true,
        shiftOffset: 0x20,
        shift: function() {
            this.type = components.Button.prototype.types.toggle;
            this.inKey = "keylock";
        },
        unshift: function() {
            this.type = components.Button.prototype.types.push;
            this.inKey = "rate_temp_up";
        }
    });

    this.pitchBendDown = new components.Button({
        currentRangeIdx: 0,
        shift: function() {
            this.input = function(channel, control, value) {
                if (value !== 0x7F) {
                    return;
                }
                this.currentRangeIdx = (this.currentRangeIdx + 1) % MixtrackProFX.pitchRanges.length;
                engine.setValue(this.group, "rateRange", MixtrackProFX.pitchRanges[this.currentRangeIdx]);
            };
        },
        unshift: function() {
            this.inKey = "rate_temp_down";
            this.input = components.Button.prototype.input;
        }
    });

    this.setBeatgrid = new components.Button({
        key: "beats_translate_curpos",
        midi: [0x98 + channel, 0x01 + (channel * 3)]
    });

    this.reconnectComponents(function(component) {
        if (component.group === undefined) {
            component.group = this.currentDeck;
        }
    });
};

MixtrackProFX.Deck.prototype = new components.Deck();

MixtrackProFX.PadSection = function(deckNumber) {
    components.ComponentContainer.call(this);

    this.blinkTimer = 0;
    this.blinkLedState = true;

    this.modes = {};
    this.modes[MixtrackProFX.PadModeControls.HOTCUE] = new MixtrackProFX.ModeHotcue(deckNumber);
    this.modes[MixtrackProFX.PadModeControls.AUTOLOOP] = new MixtrackProFX.ModeAutoLoop(deckNumber);
    this.modes[MixtrackProFX.PadModeControls.FADERCUTS] = new MixtrackProFX.ModeFaderCuts();
    this.modes[MixtrackProFX.PadModeControls.SAMPLE1] = new MixtrackProFX.ModeSample(deckNumber, false);
    this.modes[MixtrackProFX.PadModeControls.BEATJUMP] = new MixtrackProFX.ModeBeatjump(deckNumber);
    this.modes[MixtrackProFX.PadModeControls.SAMPLE2] = new MixtrackProFX.ModeSample(deckNumber, true);

    this.modeButtonPress = function(channel, control, value) {
        if (value !== 0x7F) {
            return;
        }
        this.setMode(channel, control);
    };

    this.padPress = function(channel, control, value, status, group) {
        if (this.currentMode.control === MixtrackProFX.PadModeControls.FADERCUTS) {
            // don't activate pads when in "fader cuts" mode - handled by hardware of firmware
            return;
        }
        var i = (control - 0x14) % 8;
        this.currentMode.pads[i].input(channel, control, value, status, group);
    };

    this.setMode = function(channel, control) {
        var newMode = this.modes[control];
        if (this.currentMode.control === newMode.control) {
            return; // selected mode already set, no need to change anything
        }

        this.currentMode.forEachComponent(function(component) {
            component.disconnect();
        });

        // set the correct shift state for new mode
        if (this.isShifted) {
            newMode.shift();
        } else {
            newMode.unshift();
        }

        newMode.forEachComponent(function(component) {
            component.connect();
            component.trigger();
        });

        if (MixtrackProFX.enableBlink) {
            // stop blinking if old mode was secondary mode
            if (this.currentMode.secondaryMode) {
                this.blinkLedOff();

                // disable light on the old control in case it ended up in 0x7F state
                midi.sendShortMsg(0x90 + channel, this.currentMode.unshiftedControl, 0x01);
            }

            // start blinking if new mode is a secondary mode
            if (newMode.secondaryMode) {
                this.blinkLedOn(0x90 + channel, newMode.unshiftedControl);
            }
        }

        // light off on old mode select button
        midi.sendShortMsg(0x90 + channel, this.currentMode.control, 0x01);

        // light on on new mode select button
        midi.sendShortMsg(0x90 + channel, newMode.control, newMode.lightOnValue);

        if (newMode.control === MixtrackProFX.PadModeControls.FADERCUTS) {
            // in "fader cuts" mode pad lights need to be disabled manually,
            // as pads are controlled by hardware or firmware in this mode
            // and don't have associated controls. without this, lights from
            // previously selected mode would still be on after changing mode
            // to "fader cuts"
            this.disablePadLights();
        }

        this.currentMode = newMode;
    };

    // start an infinite timer that toggles led state
    this.blinkLedOn = function(midi1, midi2) {
        this.blinkLedOff();
        this.blinkLedState = true;
        this.blinkTimer = engine.beginTimer(MixtrackProFX.blinkDelay, function() {
            midi.sendShortMsg(midi1, midi2, this.blinkLedState ? 0x7F : 0x01);
            this.blinkLedState = !this.blinkLedState;
        });
    };

    // stop the blink timer
    this.blinkLedOff = function() {
        if (this.blinkTimer === 0) {
            return;
        }

        engine.stopTimer(this.blinkTimer);
        this.blinkTimer = 0;
    };

    this.disablePadLights = function() {
        for (var i = 0; i < 16; i++) { // 0-7 = unshifted; 8-15 = shifted
            midi.sendShortMsg(0x93 + deckNumber, 0x14 + i, 0x01);
        }
    };

    this.currentMode = this.modes[MixtrackProFX.PadModeControls.HOTCUE];
};
MixtrackProFX.PadSection.prototype = Object.create(components.ComponentContainer.prototype);

MixtrackProFX.ModeHotcue = function(deckNumber) {
    components.ComponentContainer.call(this);

    this.control = MixtrackProFX.PadModeControls.HOTCUE;
    this.secondaryMode = false;
    this.lightOnValue = 0x7F;

    this.pads = new components.ComponentContainer();
    for (var i = 0; i < 8; i++) {
        this.pads[i] = new components.HotcueButton({
            group: "[Channel" + deckNumber + "]",
            midi: [0x93 + deckNumber, 0x14 + i],
            number: i + 1,
            shiftControl: true,
            sendShifted: true,
            shiftOffset: 0x08,
            outConnect: false
        });
    }
};
MixtrackProFX.ModeHotcue.prototype = Object.create(components.ComponentContainer.prototype);

MixtrackProFX.ModeAutoLoop = function(deckNumber) {
    components.ComponentContainer.call(this);

    this.control = MixtrackProFX.PadModeControls.AUTOLOOP;
    this.secondaryMode = false;
    this.lightOnValue = 0x7F;

    this.pads = new components.ComponentContainer();
    for (var i = 0; i < 8; i++) {
        this.pads[i] = new components.Button({
            group: "[Channel" + deckNumber + "]",
            midi: [0x93 + deckNumber, 0x14 + i],
            size: MixtrackProFX.autoLoopSizes[i],
            shiftControl: true,
            sendShifted: true,
            shiftOffset: 0x08,
            shift: function() {
                this.inKey = "beatlooproll_" + this.size + "_activate";
                this.outKey = "beatlooproll_" + this.size + "_activate";
            },
            unshift: function() {
                this.inKey = "beatloop_" + this.size + "_toggle";
                this.outKey = "beatloop_" + this.size + "_enabled";
            },
            outConnect: false
        });
    }
};
MixtrackProFX.ModeAutoLoop.prototype = Object.create(components.ComponentContainer.prototype);

// when pads are in "fader cuts" mode, they rapidly move the crossfader.
// holding a pad activates a "fader cut", releasing it causes the GUI crossfader
// to return to the position of physical crossfader
MixtrackProFX.ModeFaderCuts = function() {
    components.ComponentContainer.call(this);

    this.control = MixtrackProFX.PadModeControls.FADERCUTS;
    this.secondaryMode = false;
    this.lightOnValue = 0x09; // for "fader cuts" 0x09 works better than 0x7F for some reason

    // pads are controlled by hardware of firmware in this mode
    // pad input function is not called when pressing a pad in this mode
};
MixtrackProFX.ModeFaderCuts.prototype = Object.create(components.ComponentContainer.prototype);

MixtrackProFX.ModeSample = function(deckNumber, secondaryMode) {
    components.ComponentContainer.call(this);

    if (!secondaryMode) {
        // samples 1-8
        this.control = MixtrackProFX.PadModeControls.SAMPLE1;
        this.firstSampleNumber = 1;
    } else {
        // samples 9-16
        this.control = MixtrackProFX.PadModeControls.SAMPLE2;
        this.unshiftedControl = MixtrackProFX.PadModeControls.SAMPLE1;
        this.firstSampleNumber = 9;
    }
    this.secondaryMode = secondaryMode;
    this.lightOnValue = 0x7F;

    this.pads = new components.ComponentContainer();
    for (var i = 0; i < 8; i++) {
        this.pads[i] = new components.SamplerButton({
            midi: [0x93 + deckNumber, 0x14 + i],
            number: this.firstSampleNumber + i,
            shiftControl: true,
            sendShifted: true,
            shiftOffset: 0x08,
            outConnect: false
        });
    }
};
MixtrackProFX.ModeSample.prototype = Object.create(components.ComponentContainer.prototype);

MixtrackProFX.ModeBeatjump = function(deckNumber) {
    components.ComponentContainer.call(this);

    this.control = MixtrackProFX.PadModeControls.BEATJUMP;
    this.secondaryMode = true;
    this.unshiftedControl = MixtrackProFX.PadModeControls.HOTCUE;
    this.lightOnValue = 0x7F;

    this.pads = new components.ComponentContainer();
    for (var i = 0; i < 8; i++) {
        this.pads[i] = new components.Button({
            group: "[Channel" + deckNumber + "]",
            midi: [0x93 + deckNumber, 0x14 + i],
            size: MixtrackProFX.beatJumpValues[i],
            shiftControl: true,
            sendShifted: true,
            shiftOffset: 0x08,
            shift: function() {
                this.inKey = "beatjump_" + this.size + "backward";
                this.outKey = "beatjump_" + this.size + "backward";
                this.disconnect();
                this.connect();
            },
            unshift: function() {
                this.inKey = "beatjump_" + this.size + "forward";
                this.outKey = "beatjump_" + this.size + "forward";
                this.disconnect();
                this.connect();
            },
            outConnect: false
        });
    }
};
MixtrackProFX.ModeBeatjump.prototype = Object.create(components.ComponentContainer.prototype);

MixtrackProFX.Browse = function() {
    this.knob = new components.Encoder({
        shiftControl: true,
        shiftOffset: 0x01,
        input: function(channel, control, value) {
            var direction;
            if (!MixtrackProFX.shifted) {
                direction = (value > 0x40) ? value - 0x80 : value;
                engine.setParameter("[Library]", "MoveVertical", direction);
            } else {
                direction = (value > 0x40) ? "up" : "down";
                engine.setParameter("[Channel1]", "waveform_zoom_" + direction, 1);

                // need to zoom both channels if waveform sync is disabled in Mixxx settings.
                // and when it's enabled then no need to zoom 2nd channel, as it will cause
                // the zoom to jump 2 levels at once
                if (!MixtrackProFX.waveformsSynced) {
                    engine.setParameter("[Channel2]", "waveform_zoom_" + direction, 1);
                }
            }
        }
    });

    this.knobButton = new components.Button({
        group: "[Library]",
        shiftControl: true,
        shiftOffset: 0x01,
        shift: function() {
            this.inKey = "GoToItem";
        },
        unshift: function() {
            this.inKey = "MoveFocusForward";
        }
    });
};
MixtrackProFX.Browse.prototype = new components.ComponentContainer();

MixtrackProFX.Gains = function() {
    this.mainGain = new components.Pot({
        group: "[Master]",
        inKey: "gain"
    });

    this.cueGain = new components.Pot({
        group: "[Master]",
        inKey: "headGain"
    });

    this.cueMix = new components.Pot({
        group: "[Master]",
        inKey: "headMix"
    });
};
MixtrackProFX.Gains.prototype = new components.ComponentContainer();

MixtrackProFX.vuCallback = function(value, group) {
    var level = value * 90;
    var deckOffset = script.deckFromGroup(group) - 1;
    midi.sendShortMsg(0xB0 + deckOffset, 0x1F, level);
};

MixtrackProFX.wheelTouch = function(channel, control, value) {
    var deckNumber = channel + 1;

    if (!MixtrackProFX.shifted && MixtrackProFX.deck[channel].scratchModeEnabled && value === 0x7F) {
        // touch start

        engine.scratchEnable(deckNumber, MixtrackProFX.jogScratchSensitivity, 33+1/3, MixtrackProFX.jogScratchAlpha, MixtrackProFX.jogScratchBeta, true);
    } else if (value === 0) {
        // touch end
        engine.scratchDisable(deckNumber, true);
    }
};

MixtrackProFX.wheelTurn = function(channel, control, value, status, group) {
    var deckNumber = channel + 1;

    var newValue = value;

    if (value >= 64) {
        // correct the value if going backwards
        newValue -= 128;
    }

    if (MixtrackProFX.shifted) {
        // seek
        var oldPos = engine.getValue(group, "playposition");

        engine.setValue(group, "playposition", oldPos + newValue / MixtrackProFX.jogSeekSensitivity);
    } else if (MixtrackProFX.deck[channel].scratchModeEnabled && engine.isScratching(deckNumber)) {
        // scratch
        engine.scratchTick(deckNumber, newValue);
    } else {
        // pitch bend
        engine.setValue(group, "jog", newValue / MixtrackProFX.jogPitchSensitivity);
    }
};
