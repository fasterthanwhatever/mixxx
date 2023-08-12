HIDController.prototype.softTakeover = function() {
    for (let i = 1; i < arguments.length; i++) {
        engine.softTakeover(arguments[0], arguments[i], true);
    }
};

HIDController.prototype.softTakeoverAll = function() {
    for (let channel = 1; channel < 5; channel++) {
        this.softTakeover("[EqualizerRack1_[Channel" + channel + "]_Effect1]", "parameter1", "parameter2", "parameter3");
        this.softTakeover("[QuickEffectRack1_[Channel" + channel + "]]", "super1");
        this.softTakeover("[Channel" + channel + "]", "pregain", "volume", "rate");
        for (let i = 1; i < 4; i++) {
            this.softTakeover("[EffectRack1_EffectUnit" + channel + "_Effect" + i + "]", "meta");
        }
    }
    this.softTakeover("[Master]", "headMix", "crossfader");
};

HIDPacket.prototype.clearControls = function() {
    for (const groupName in this.groups) {
        const group = this.groups[groupName];
        for (const control in group) {
            group[control].value = 0;
        }
    }
    this.send();
};

HIDController.prototype.getLightsPacket = function(packetName) {
    return this.getOutputPacket(packetName || "lights");
};

HIDController.prototype.sendLightsUpdate = function(packetName) {
    this.getLightsPacket(packetName).send();
};

HIDController.prototype.connectLight = function(group, name, setter) {
    setter(engine.getValue(group, name), this.getLightsPacket(), group, name);
    const fun = function(value, group, name) {
        setter(value, this.getLightsPacket(), group, name);
        this.sendLightsUpdate();
    };
    engine.makeConnection(group, name, fun);
    this.sendLightsUpdate();
    return fun;
};



class TraktorZ1Class {
    constructor() {
        this.controller = new HIDController();

        this.controller.softTakeoverAll();

        this.mode = "default";
        this.knobs = {};
    }

    // region CONTROLS
    registerInputPackets() {
        const packet = new HIDPacket("control", 0x1);

        for (let c = 1; c < 3; c++) {
            const o = c * 10;
            packet.addControl("hid", c + "_gain", o - 9, "H");
            packet.addControl("hid", c + "_hi", o - 7, "H");
            packet.addControl("hid", c + "_mid", o - 5, "H");
            packet.addControl("hid", c + "_low", o - 3, "H");
            packet.addControl("hid", c + "_fx", o - 1, "H");
        }
        packet.addControl("hid", "cue_mix", 21, "H");
        packet.addControl("hid", "1_vol", 23, "H");
        packet.addControl("hid", "2_vol", 25, "H");
        packet.addControl("hid", "crossfader", 27, "H");

        const button = function(name, code) {
            packet.addControl("hid", name, 29, "B", code);
        };
        button("mode", 0x2);
        button("1_headphone", 0x10);
        button("2_headphone", 0x1);
        button("1_button_fx", 0x4);
        button("2_button_fx", 0x8);

        this.controller.registerInputPacket(packet);
    }

    registerCallbacks() {
        HIDDebug("Registering HID callbacks");

        const controller = this.controller;

        controller.linkModifier("hid", "mode", "mode");

        for (let channel = 1; channel < 3; channel++) {
            controller.setCallback("control", "hid", channel + "_headphone", function(button) {
                const ch = button.name.substr(0, 1);

                if (button.value === controller.buttonStates.pressed) {
                    if (engine.getValue("[Channel" + ch + "]", "pfl") === 0) {
                        engine.setValue("[Channel" + ch + "]", "pfl", 1);
                    } else {
                        engine.setValue("[Channel" + ch + "]", "pfl", 0);
                    }
                }
            });
            controller.setCallback("control", "hid", channel + "_button_fx", function(button) {
                const ch = button.name.substr(0, 1);
                if (button.value === controller.buttonStates.pressed) {
                    if (controller.modifiers.get("mode")) {
                        controller.toggle("[Channel" + ch + "]", "play");
                    } else {
                        const newVal = engine.getParameter("[QuickEffectRack1_[Channel" + ch + "]_Effect1]", "enabled") ? 0 : 1;
                        engine.setParameter("[EqualizerRack1_[Channel" + ch + "]_Effect1]", "enabled", newVal);
                        engine.setParameter("[QuickEffectRack1_[Channel" + ch + "]_Effect1]", "enabled", newVal);
                    }
                }
            });

            this.linkKnob("default", channel + "_gain", "[Channel" + channel + "]", "pregain");
            this.linkKnob("default", channel + "_hi", "[EqualizerRack1_[Channel" + channel + "]_Effect1]", "parameter3");
            this.linkKnob("default", channel + "_mid", "[EqualizerRack1_[Channel" + channel + "]_Effect1]", "parameter2");
            this.linkKnob("default", channel + "_low", "[EqualizerRack1_[Channel" + channel + "]_Effect1]", "parameter1");
            this.linkKnob("default", channel + "_fx", "[QuickEffectRack1_[Channel" + channel + "]]", "super1");

            controller.setCallback("control", "hid", channel + "_gain", this.knob);
            controller.setCallback("control", "hid", channel + "_hi", this.knob);
            controller.setCallback("control", "hid", channel + "_mid", this.knob);
            controller.setCallback("control", "hid", channel + "_low", this.knob);
            controller.setCallback("control", "hid", channel + "_fx", this.knob);

            this.linkKnob("default", channel + "_vol", "[Channel" + channel + "]", "volume");
            controller.setCallback("control", "hid", channel + "_vol", this.knob);
        }

        this.linkKnob("default", "cue_mix", "[Master]", "headMix");
        controller.setCallback("control", "hid", "cue_mix", this.knob);
        this.linkKnob("default", "crossfader", "[Master]", "crossfader");
        controller.setCallback("control", "hid", "crossfader", this.knob);
    }

    // endregion
    // region LIGHTS
    registerOutputPackets() {
        const packet = new HIDPacket("lights", 0x80);

        for (let c = 1; c < 3; c++) {
            for (let i = 1; i < 8; i++) {
                packet.addOutput("hid", "ch" + c + "_meter_segment" + i, i + (c - 1) * 7, "B");
            }
            packet.addOutput("hid", c + "_headphone", 14 + c, "B");
            packet.addOutput("hid", c + "_button_fx_red", 14 + c * 3, "B");
            packet.addOutput("hid", c + "_button_fx_blue", 15 + c * 3, "B");
        }
        packet.addOutput("hid", "mode", 19, "B");

        this.controller.registerOutputPacket(packet);
    }

    // endregion

    init(id) {
        this.id = id;

        this.registerInputPackets();
        this.registerOutputPackets();
        this.registerCallbacks();


        this.brightness = 0x7f;
        this.brightnessRange = 1.0 / 7;
        this.refreshVolumeLights = function(value, group) {
            const packet = this.controller.getLightsPacket();
            const channel = group.substr(8, 1);
            for (let i = 0; i < 7; i++) {
                const br = Math.max(Math.min((value - i * this.brightnessRange) * 7, 1), 0) * this.brightness;
                packet.getField("hid", "ch" + channel + "_meter_segment" + (i + 1)).value = br;
            }
            this.controller.sendLightsUpdate();
        };


        for (let c = 1; c < 3; c++) {
            engine.makeConnection("[Channel" + c + "]", "VuMeter", this.refreshVolumeLights);
            this.controller.connectLight("[Channel" + c + "]", "pfl", function(value, packet, group) {
                const channel = group.substr(8, 1);
                packet.getField("hid", channel + "_headphone").value = value * 0x7F;
            });
            this.controller.connectLight("[QuickEffectRack1_[Channel" + c + "]_Effect1]", "enabled", function(value, packet, group) {
                const channel = group.substr(26, 1);
                packet.getField("hid", channel + "_button_fx_red").value = value * 0x7F;
                packet.getField("hid", channel + "_button_fx_blue").value = value * 0x7F;
            });
        }

        // print("NI Traktor Kontrol Z1 " + this.id + " initialized!");
    }


    // region knobs

    linkKnob(mode, knob, group, name) {
        if (!(mode in this.knobs)) { this.knobs[mode] = {}; }
        this.knobs[mode][knob] = {
            "mode": mode,
            "knob": knob,
            "group": group,
            "name": name,
        };
    }

    control(control, field) {
        if (control.callback !== undefined) {
            control.callback(control, field);
            return;
        }
        engine.setParameter(control.group, control.name, field.value / 4096);
    }

    knob(field) {
        const mode = this.knobs[this.mode];
        if (mode === undefined) {
            HIDDebug("Knob group not mapped in mode " + this.mode);
            return;
        }
        const knob = mode[field.name];
        if (knob === undefined) {
            HIDDebug("Fader " + field.name + " not mapped in " + this.mode);
            return;
        }
        return this.control(knob, field);
    }
    // endregion

    shutdown() {
        this.controller.getLightsPacket().clearControls();
        //print("NI Traktor Kontrol Z1 " + this.id + " shut down!");
    }

    incomingData(data, length) {
        this.controller.parsePacket(data, length);
    }
}

var TraktorZ1 = new TraktorZ1Class;  // eslint-disable-line no-var, no-unused-vars
