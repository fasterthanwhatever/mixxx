/***************************************************************************
                          dlgprefkey.cpp  -  description
                             -------------------
    begin                : Thu Jun 7 2012
    copyright            : (C) 2012 by Keith Salisbury
    email                : keithsalisbury@gmail.com
***************************************************************************/

/***************************************************************************
*                                                                         *
*   This program is free software; you can redistribute it and/or modify  *
*   it under the terms of the GNU General Public License as published by  *
*   the Free Software Foundation; either version 2 of the License, or     *
*   (at your option) any later version.                                   *
*                                                                         *
***************************************************************************/

#include "preferences/dialog/dlgprefkey.h"

#include <QLineEdit>
#include <QMessageBox>

#include "analyzer/analyzerkey.h"
#include "controlobject.h"
#include "track/key_preferences.h"
#include "util/xml.h"

DlgPrefKey::DlgPrefKey(QWidget* parent, UserSettingsPointer _config)
        : DlgPreferencePage(parent),
          Ui::DlgPrefKeyDlg(),
          m_pConfig(_config),
          m_bAnalyzerEnabled(false),
          m_bFastAnalysisEnabled(false),
          m_bReanalyzeEnabled(false) {
    setupUi(this);

    m_keyLineEdits.insert(mixxx::track::io::key::C_MAJOR, c_major_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::D_FLAT_MAJOR, d_flat_major_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::D_MAJOR, d_major_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::E_FLAT_MAJOR, e_flat_major_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::E_MAJOR, e_major_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::F_MAJOR, f_major_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::F_SHARP_MAJOR, f_sharp_major_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::G_MAJOR, g_major_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::A_FLAT_MAJOR, a_flat_major_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::A_MAJOR, a_major_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::B_FLAT_MAJOR, b_flat_major_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::B_MAJOR, b_major_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::C_MINOR, c_minor_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::C_SHARP_MINOR, c_sharp_minor_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::D_MINOR, d_minor_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::E_FLAT_MINOR, e_flat_minor_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::E_MINOR, e_minor_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::F_MINOR, f_minor_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::F_SHARP_MINOR, f_sharp_minor_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::G_MINOR, g_minor_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::G_SHARP_MINOR, g_sharp_minor_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::A_MINOR, a_minor_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::B_FLAT_MINOR, b_flat_minor_edit);
    m_keyLineEdits.insert(mixxx::track::io::key::B_MINOR, b_minor_edit);

    m_availablePlugins = AnalyzerKey::availablePlugins();
    for (const AnalyzerPluginInfo& info : m_availablePlugins) {
        plugincombo->addItem(info.name, info.id);
    }

    loadSettings();

    // Connections
    connect(plugincombo, SIGNAL(currentIndexChanged(int)),
            this, SLOT(pluginSelected(int)));
    connect(banalyzerenabled, SIGNAL(stateChanged(int)),
            this, SLOT(analyzerEnabled(int)));
    connect(bfastAnalysisEnabled, SIGNAL(stateChanged(int)),
            this, SLOT(fastAnalysisEnabled(int)));
    connect(breanalyzeEnabled, SIGNAL(stateChanged(int)),
            this, SLOT(reanalyzeEnabled(int)));

    connect(radioNotationOpenKey, SIGNAL(toggled(bool)),
            this, SLOT(setNotationOpenKey(bool)));
    connect(radioNotationLancelot, SIGNAL(toggled(bool)),
            this, SLOT(setNotationLancelot(bool)));
    connect(radioNotationTraditional, SIGNAL(toggled(bool)),
            this, SLOT(setNotationTraditional(bool)));
    connect(radioNotationCustom, SIGNAL(toggled(bool)),
            this, SLOT(setNotationCustom(bool)));
}

DlgPrefKey::~DlgPrefKey() {
}

void DlgPrefKey::loadSettings() {
    qDebug() << "DlgPrefKey::loadSettings";
    QString keyPluginId = m_pConfig->getValueString(
        ConfigKey(VAMP_CONFIG_KEY, VAMP_ANALYZER_KEY_PLUGIN_ID));
    qDebug() << "Key plugin ID:" << keyPluginId;

    if (keyPluginId.isEmpty()) {
        slotResetToDefaults();
        slotApply(); // Write to config file so AnalyzerKey can get the data
        return;
    }

    m_selectedAnalyzerId = keyPluginId;

    m_bAnalyzerEnabled = static_cast<bool>(m_pConfig->getValueString(
        ConfigKey(KEY_CONFIG_KEY, KEY_DETECTION_ENABLED)).toInt());

    m_bFastAnalysisEnabled = static_cast<bool>(m_pConfig->getValueString(
        ConfigKey(KEY_CONFIG_KEY, KEY_FAST_ANALYSIS)).toInt());

    m_bReanalyzeEnabled = static_cast<bool>(m_pConfig->getValueString(
        ConfigKey(KEY_CONFIG_KEY, KEY_REANALYZE_WHEN_SETTINGS_CHANGE)).toInt());

    QString notation = m_pConfig->getValueString(
        ConfigKey(KEY_CONFIG_KEY, KEY_NOTATION));
    if (notation == KEY_NOTATION_OPEN_KEY) {
        radioNotationOpenKey->setChecked(true);
        setNotationOpenKey(true);
    } else if (notation == KEY_NOTATION_LANCELOT) {
        radioNotationLancelot->setChecked(true);
        setNotationLancelot(true);
    } else if (notation == KEY_NOTATION_TRADITIONAL) {
        radioNotationTraditional->setChecked(true);
        setNotationTraditional(true);
    } else if (notation == KEY_NOTATION_CUSTOM) {
        radioNotationCustom->setChecked(true);
        for (QMap<mixxx::track::io::key::ChromaticKey, QLineEdit*>::const_iterator it =
                     m_keyLineEdits.begin();
             it != m_keyLineEdits.end(); ++it) {
            it.value()->setText(m_pConfig->getValueString(
                ConfigKey(KEY_CONFIG_KEY, KEY_NOTATION_CUSTOM_PREFIX +
                          QString::number(it.key()))));
        }
        setNotationCustom(true);
    } else {
        radioNotationOpenKey->setChecked(true);
        setNotationOpenKey(true);
    }

    slotUpdate();
}

void DlgPrefKey::slotResetToDefaults() {
    m_bAnalyzerEnabled = true;
    m_bFastAnalysisEnabled = false;
    m_bReanalyzeEnabled = false;
    // TODO(rryan)
    m_selectedAnalyzerId = VAMP_ANALYZER_KEY_DEFAULT_PLUGIN_ID;
    // if (!m_listIdentifier.contains(m_selectedAnalyzer)) {
    //     qDebug() << "DlgPrefKey: qm-keydetector Vamp plugin not found";
    //     m_bAnalyzerEnabled = false;
    // }

    radioNotationTraditional->setChecked(true);
    setNotationTraditional(true);

    slotUpdate();
}

void DlgPrefKey::pluginSelected(int i) {
    if (i == -1) {
        return;
    }
    m_selectedAnalyzerId = m_availablePlugins[i].id;
    slotUpdate();
}

void DlgPrefKey::analyzerEnabled(int i) {
    m_bAnalyzerEnabled = static_cast<bool>(i);
    slotUpdate();
}

void DlgPrefKey::fastAnalysisEnabled(int i) {
    m_bFastAnalysisEnabled = static_cast<bool>(i);
    slotUpdate();
}

void DlgPrefKey::reanalyzeEnabled(int i){
    m_bReanalyzeEnabled = static_cast<bool>(i);
    slotUpdate();
}

void DlgPrefKey::slotApply() {
    // TODO(rryan)
    // int selected = m_listIdentifier.indexOf(m_selectedAnalyzerId);
    // if (selected == -1) {
    //     return;
    // }

    // m_pConfig->set(
    //     ConfigKey(VAMP_CONFIG_KEY, VAMP_ANALYZER_KEY_LIBRARY),
    //     ConfigValue(m_listLibrary[selected]));
    m_pConfig->set(
        ConfigKey(VAMP_CONFIG_KEY, VAMP_ANALYZER_KEY_PLUGIN_ID),
        ConfigValue(m_selectedAnalyzerId));
    m_pConfig->set(
        ConfigKey(KEY_CONFIG_KEY, KEY_DETECTION_ENABLED),
        ConfigValue(m_bAnalyzerEnabled ? 1 : 0));
    m_pConfig->set(
        ConfigKey(KEY_CONFIG_KEY, KEY_FAST_ANALYSIS),
        ConfigValue(m_bFastAnalysisEnabled ? 1 : 0));
    m_pConfig->set(
        ConfigKey(KEY_CONFIG_KEY, KEY_REANALYZE_WHEN_SETTINGS_CHANGE),
        ConfigValue(m_bReanalyzeEnabled ? 1 : 0));

    QMap<mixxx::track::io::key::ChromaticKey, QString> notation;

    if (radioNotationCustom->isChecked()) {
        m_pConfig->set(
            ConfigKey(KEY_CONFIG_KEY, KEY_NOTATION),
            ConfigValue(KEY_NOTATION_CUSTOM));

        for (QMap<mixxx::track::io::key::ChromaticKey, QLineEdit*>::const_iterator it =
                     m_keyLineEdits.begin();
             it != m_keyLineEdits.end(); ++it) {
            notation[it.key()] = it.value()->text();
            m_pConfig->set(
                ConfigKey(KEY_CONFIG_KEY, KEY_NOTATION_CUSTOM_PREFIX +
                          QString::number(it.key())),
                ConfigValue(it.value()->text()));
        }
    } else {
        QString notation_name;
        KeyUtils::KeyNotation notation_type;
        if (radioNotationOpenKey->isChecked()) {
            notation_name = KEY_NOTATION_OPEN_KEY;
            notation_type = KeyUtils::OPEN_KEY;
        } else if (radioNotationTraditional->isChecked()) {
            notation_name = KEY_NOTATION_TRADITIONAL;
            notation_type = KeyUtils::TRADITIONAL;
        } else {
            // Either Lancelot was chosen or somehow no radio button was chosen.
            notation_name = KEY_NOTATION_LANCELOT;
            notation_type = KeyUtils::LANCELOT;
        }

        m_pConfig->set(
            ConfigKey(KEY_CONFIG_KEY, KEY_NOTATION),
            ConfigValue(notation_name));

        // This is just a handy way to iterate the keys. We don't use the
        // QLineEdits.
        for (QMap<mixxx::track::io::key::ChromaticKey, QLineEdit*>::const_iterator it =
                     m_keyLineEdits.begin(); it != m_keyLineEdits.end(); ++it) {
            notation[it.key()] = KeyUtils::keyToString(it.key(), notation_type);
        }
    }

    KeyUtils::setNotation(notation);
}

void DlgPrefKey::slotUpdate() {
    plugincombo->setEnabled(m_bAnalyzerEnabled);
    banalyzerenabled->setChecked(m_bAnalyzerEnabled);
    bfastAnalysisEnabled->setChecked(m_bFastAnalysisEnabled);
    breanalyzeEnabled->setChecked(m_bReanalyzeEnabled);
    slotApply();

    if (!m_bAnalyzerEnabled) {
        return;
    }

    for (int i = 0; i < m_availablePlugins.size(); ++i) {
        const auto& info = m_availablePlugins.at(i);
        if (info.id == m_selectedAnalyzerId) {
            plugincombo->setCurrentIndex(i);
            break;
        }
    }
}

void DlgPrefKey::setNotationCustom(bool active) {
    if (!active) {
        return;
    }

    for (QMap<mixxx::track::io::key::ChromaticKey, QLineEdit*>::const_iterator it =
                 m_keyLineEdits.begin();
         it != m_keyLineEdits.end(); ++it) {
        it.value()->setEnabled(true);
    }
    slotUpdate();
}

void DlgPrefKey::setNotation(KeyUtils::KeyNotation notation) {
    for (QMap<mixxx::track::io::key::ChromaticKey, QLineEdit*>::const_iterator it =
                 m_keyLineEdits.begin(); it != m_keyLineEdits.end(); ++it) {
        it.value()->setText(KeyUtils::keyToString(it.key(), notation));
        it.value()->setEnabled(false);
    }
    slotUpdate();
}

void DlgPrefKey::setNotationTraditional(bool active) {
    if (active) {
        setNotation(KeyUtils::TRADITIONAL);
    }
}

void DlgPrefKey::setNotationOpenKey(bool active) {
    if (active) {
        setNotation(KeyUtils::OPEN_KEY);
    }
}

void DlgPrefKey::setNotationLancelot(bool active) {
    if (active) {
        setNotation(KeyUtils::LANCELOT);
    }
}
