hide;
set_x -189.0000000000001;
set_y -61;
set_size 65;
set_rotation_style_left_right;
costumes "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e01 (5).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e01", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e03 (3).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e03", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e04 (4).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e04", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e06 (3).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e06", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e02 (3).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e02", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e05 (3).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e05";
sounds "assets/Crunch.wav", "assets/\u58c1\u30ad\u30c3\u30af.wav", "assets/\u30b8\u30e3\u30f3\u30d72.mp3", "assets/Nebula.wav", "assets/Starship.mp3", "assets/PIKASONIC - Osaka Express .mp3", "assets/Vexento - Tevo .wav", "assets/Vexento - Pixel Party.wav", "assets/Unlimited.mp3", "assets/\u30b8\u30e3\u30f3\u30d73.wav";
var x2 = 9.556872110340797e-165;
var y2 = "0";
var k = 0;
var mgi = 0;
var hid = 0;
var h = 0;
var clone_ = 0;
var i = 0;
var intro_x = 0;
var sss = 0;
var clone_x = 0;
var clone_y = 0;
var clone_dir = 0;
var clone_z = 0;
var id = 0;
var cam_control = 0;
var swtype = 0;
var sw = 0;
var sw_z = 0;
var sw_c = 0;
var sw_dir = 0;
var cos_ = 0;
var player_y = 0;
var player_xv = 0;
var player_yv = 0;
var player_x = 0;
var rw = 0;
var rw_c = 0;
var rw_siz = 0;
var fw = 0;
var fw_color = 0;
var fw_type = 0;
var fw2 = 0;
var _7 = 0;
var a = 0;
var b = 0;
list fw3;
list _8;
on "\u30a4\u30f3\u30c8\u30ed\u5b8c" {
    wait 1;
    goto -150, 0;
    show;
    set_rotation_style_left_right;
    x2 = 0;
    y2 = 0;
    set_size 65;
    forever {
        if key_pressed("w") or key_pressed("up arrow") or mouse_down() and 0 < mouse_y() {
            if (key_pressed("w") or key_pressed("up arrow")) and (key_pressed("d") or key_pressed("right arrow") or (key_pressed("a") or key_pressed("left arrow"))) or mouse_down() and 0 < mouse_y() {
                switch_costume "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e04";
            }
            else {
                switch_costume "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e06";
            }
        }
        else {
            switch_costume "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e01";
            if key_pressed("a") or key_pressed("left arrow") or mouse_down() and mouse_x() < 0 {
                switch_costume "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e02";
            }
            elif key_pressed("d") or key_pressed("right arrow") or mouse_down() and 0 < mouse_x() {
                switch_costume "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e02";
            }
            else {
                switch_costume "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e01";
            }
        }
        if key_pressed("d") or key_pressed("right arrow") or mouse_down() and 0 < mouse_x() {
            point_in_direction 90;
            x2 += 1.75;
        }
        if key_pressed("a") or key_pressed("left arrow") or mouse_down() and mouse_x() < 0 {
            x2 += -1.75;
            point_in_direction -90;
        }
        x2 *= 0.8;
        change_x x2;
        if touching("\u52d5\u304f\u30b9\u30c6\u30fc\u30b8") or (touching("\u30b9\u30c6\u30fc\u30b8") or false) {
            change_y 1;
            if touching("\u52d5\u304f\u30b9\u30c6\u30fc\u30b8") or (touching("\u30b9\u30c6\u30fc\u30b8") or false) {
                change_y 1;
                if touching("\u52d5\u304f\u30b9\u30c6\u30fc\u30b8") or (touching("\u30b9\u30c6\u30fc\u30b8") or false) {
                    change_y 1;
                    if touching("\u52d5\u304f\u30b9\u30c6\u30fc\u30b8") or (touching("\u30b9\u30c6\u30fc\u30b8") or false) {
                        change_y 1;
                        if touching("\u52d5\u304f\u30b9\u30c6\u30fc\u30b8") or (touching("\u30b9\u30c6\u30fc\u30b8") or false) {
                            change_y 1;
                            if touching("\u52d5\u304f\u30b9\u30c6\u30fc\u30b8") or (touching("\u30b9\u30c6\u30fc\u30b8") or (touching("\u9375\u7a74") or touching("\u9375\u7a742"))) {
                                change_x x2 * -1;
                                change_y -5;
                                if (key_pressed("w") or key_pressed("up arrow") or mouse_down() and 0 < mouse_y()) and not touching("\u6c34") {
                                    start_sound "\u58c1\u30ad\u30c3\u30af";
                                    if x2 > 0 {
                                        x2 = -15;
                                    }
                                    else {
                                        x2 = 15;
                                    }
                                    y2 = 15.5;
                                }
                                else {
                                    x2 = 0;
                                }
                            }
                        }
                    }
                }
            }
        }
        y2 += -1;
        change_y y2;
        if touching("\u52d5\u304f\u30b9\u30c6\u30fc\u30b8") or (touching("\u30b9\u30c6\u30fc\u30b8") or (touching("\u9375\u7a74") or touching("\u9375\u7a742"))) {
            change_y y2 * -1;
            y2 = 0;
        }
        if key_pressed("w") or key_pressed("up arrow") or mouse_down() and 0 < mouse_y() {
            change_y -1;
            if (touching("\u52d5\u304f\u30b9\u30c6\u30fc\u30b8") or (touching("\u30b9\u30c6\u30fc\u30b8") or (touching("\u9375\u7a74") or touching("\u9375\u7a742")))) and (key_pressed("w") or key_pressed("up arrow") or mouse_down() and 0 < mouse_y()) {
                y2 += 17;
                start_sound "\u30b8\u30e3\u30f3\u30d73";
            }
            change_y 1;
        }
        if 240 < x_position() {
            broadcast "\u6b21\u306e\u30b9\u30c6\u30fc\u30b8";
            goto -210, 0;
            _6 = 1;
            wait 3;
            x2 = 0;
            y2 = 0;
        }
        if touching("\u30b8\u30e3\u30f3\u30d7\u53f0") {
            start_sound "\u30b8\u30e3\u30f3\u30d73";
            y2 = 20;
        }
        if y_position() < -182 or (touching("\u91dd") or (touching("\u6575\u30ad\u30e3\u30e9") or (touching("\u91dd(\u7279\u6b8a?)") or touching("\u52d5\u304f\u91dd2")))) {
            if touching("\u6575\u30ad\u30e3\u30e9") {
                if touching_color("#da4343") {
                    if touching_color("#dd4848") {
                        _16;
                    }
                }
                else {
                    _16;
                }
            }
            else {
                _16;
            }
        }
        clone;
        broadcast "huhh0";
    }
}
onflag {
    hide;
}
nowarp proc _16 {
    taimu = 0;
    broadcast "respawn";
    start_sound "Crunch";
    goto -210, 0;
    show;
    x2 = 0;
    y2 = 0;
}
on "\u3059\u3066\u30fc\u3058\u304b\u308f\u3063\u305f" {
    wait 0.8;
    _17;
}
on "\u6b21!" {
    hide;
    wait 2.5;
}
onclone {
    switch_costume "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e03";
    _18;
}
nowarp proc _17 {
    _6 = 0;
    goto -210, 0;
    show;
    switch_costume "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e01";
}
onclone {
    set_ghost_effect 0;
    switch_costume "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e03";
    repeat 15 {
        change_size -2;
        change_ghost_effect 7;
    }
    delete_this_clone;
}
nowarp proc _18 {
    set_ghost_effect 0;
    repeat 5 {
        change_ghost_effect 20;
    }
    delete_this_clone;
}
on "\u30a4\u30f3\u30c8\u30ed\u5b8c" {
    forever {
        until touching("\u6c34") {}
        if key_pressed("up arrow") or mouse_down() and 0 < mouse_y() {
            y2 = 5;
        }
        else {
            y2 = -1.5;
        }
    }
}
on "\u30a4\u30f3\u30c8\u30ed\u5b8c" {
    _6 = 0;
    set_volume 100;
    forever {
        wait 1;
        play_sound_until_done random(4, 9);
    }
}
on "huhh0" {
    if not (touching("\u52d5\u304f\u30b9\u30c6\u30fc\u30b8") or (touching("\u30b9\u30c6\u30fc\u30b8") or (touching("\u9375\u7a74") or touching("\u9375\u7a742")))) {
        change_y -1;
    }
}
onflag {
    broadcast "Intro start";
}
# Dummy receiver: the original project declares a broadcast (used by _16)
# with no receiving script. goboscript only registers broadcasts that have a
# receiver, and names it "respawn" (the original name "i" collides with the
# player variable "i" because goboscript uses names as ids, which makes the
# VM log a spurious type-mismatch error on compile).
on "respawn" {
}
