hide;
set_size 9.383095409240108;
costumes "assets/Filler (Size).svg", "assets/Filler (Movement).svg", "assets/le1.svg", "assets/le2.svg", "assets/le4.svg", "assets/le5.svg", "assets/le7.svg", "assets/le8.svg", "assets/le10.svg", "assets/le11.svg", "assets/le13.svg", "assets/le14.svg", "assets/le16.svg", "assets/le17.svg", "assets/le21.svg", "assets/Screen.png", "assets/Bar.svg", "assets/Light.png", "assets/text.svg", "assets/g.svg", "assets/o.svg", "assets/r.svg", "assets/i.svg", "assets/r2.svg", "assets/a.svg", "assets/f.svg", "assets/back.svg", "assets/sw.png", "assets/12sw.svg" as "1/2sw", "assets/Diamond 1.svg", "assets/Diamond 2.svg", "assets/Diamond 3.svg", "assets/Diamond 4.svg", "assets/Diamond 5.svg", "assets/Diamond 6.svg", "assets/Diamond 7.svg", "assets/Diamond 8.svg", "assets/Diamond 9.svg", "assets/Diamond 10.svg", "assets/Diamond 11.svg", "assets/Diamond 12.svg", "assets/Diamond 13.svg", "assets/Diamond 14.svg", "assets/Diamond 15.svg", "assets/Diamond 16.svg", "assets/Diamond 17.svg", "assets/Diamond 18.svg", "assets/Diamond 19.svg", "assets/Diamond 20.svg", "assets/Diamond 21.svg", "assets/Diamond 22.svg", "assets/Diamond 23.svg", "assets/\u304a\u304a\u304d\u3055\u304b\u3093\u308a\u3088\u3046().svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e01 (3).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e01";
sounds "assets/Catch Me (Wy Flip).wav";
var clone_x = "";
var clone_y = "";
var clone_dir = "90";
var clone_z = "0";
var id = "back";
var cam_control = "";
var swtype = "a";
var sw = 7897.469567994436;
var sw_z = "100";
var sw_c = "115";
var sw_dir = "";
var cos_ = 1;
var player_y = 0;
var player_xv = 0;
var player_yv = 0;
var player_y = 0;
var player_x = 0;
var rw = "1";
var rw_c = "120";
var rw_siz = "200";
var fw = 0;
var fw_color = "125";
var fw_type = "b";
var fw2 = 20;
var _7 = "10";
var a = "1";
var b = "1";
list fw3 = ["2", "4", "6", "8", "10", "12", "14", "16", "18", "20"];
list _8 = ["3.33", "4.29", "5", "5.74", "6.3", "6", "7.1", "", "8.2", "9.8", "10.5"];
nowarp proc _3 _9, _10, x2, y2 {
    _3 = 60;
    repeat $_9 {
        _3 += -_3 / 5;
        goto sin(timer() * 600) * 0.9 * _3 + $x2, cos(timer() * 600) * 0.9 * _3 + $y2;
        point_in_direction sin(timer() * 800) * 1.5 * (_3 / 7) + $_10;
        shakedir = sin(timer() * 800) * 1.5 * (_3 / 7) + ($_10 - 90);
        shakex = sin(timer() * 600) * 0.9 * _3 + $x2;
        shakey = cos(timer() * 600) * 0.9 * _3 + $y2;
    }
}
onclone {
    show;
    if cam_control == 1 {
        forever {
            position costume_name();
        }
    }
}
proc position _11 {
    if size() > 100 {
        switch_costume "Filler (Size)";
    }
    else {
        switch_costume "Screen";
    }
    set_size clone_z * z;
    switch_costume "Filler (Movement)";
    point_in_direction clone_dir - (dir + shakedir);
    goto (clone_x + (x + shakex)) * z * cos(dir + shakedir) - (clone_y + (y + shakey)) * z * sin(dir + shakedir), (clone_x + (x + shakex)) * z * sin(dir + shakedir) + (clone_y + (y + shakey)) * z * cos(dir + shakedir);
    switch_costume $_11;
}
proc clone_ id, cc {
    cam_control = $cc;
    id = $id;
    clone;
}
nowarp proc wait_ time2 {
    until timer() > $time2 {}
}
on "Intro start" {
    switch_costume "\u304a\u304a\u304d\u3055\u304b\u3093\u308a\u3088\u3046()";
    reset_timer;
    goto 0, 0;
    point_in_direction 90;
    set_size 0;
    hide;
    dir = 0;
    x = 0;
    y = 0;
    z = 1;
    clone_dir = 90;
    clone_x = "";
    clone_y = "";
    clone_z = 0;
}
on "Intro start" {
    clone_ "back", "";
    wait_ 3;
    clone_ "text", 1;
    fw_type2 "", "", 200, 10, 130, "b";
}
onclone {
    if id == "text" {
        goto_front;
        clone_z = 0;
        switch_costume "text";
        until round(clone_z) == 100 {
            clone_z += (100 - clone_z) / 3;
        }
        wait_ 4;
        hide;
        wait_ 4.5;
        show;
        wait_ 10.5;
        _12;
        delete_this_clone;
    }
}
proc sw_type_xydir_size_color _11, x2, y2, d, z2, c {
    sw_c = $c;
    swtype = $_11;
    clone_x = $x2;
    clone_y = $y2;
    sw_z = $z2;
    sw_dir = $d;
    cam_control = 1;
    id = "sw";
    clone;
    clone_x = $x2 + 25;
    clone_y = $y2 - 15;
    id = "sw\u5f71";
    clone;
}
onclone {
    if id == "light" {
        set_size 100;
        goto_front;
        switch_costume "Light";
    }
}
onclone {
    if id == "back" {
        set_size 100;
        goto_back;
        switch_costume "back";
        set_ghost_effect 100;
        repeat 50 {
            change_ghost_effect -2;
        }
    }
}
onclone {
    if id == "sw" {
        goto_front;
        if swtype == "a" {
            set_color_effect sw_c;
            sw = 10;
            clone_z = 0;
            switch_costume "sw";
            set_fisheye_effect 0;
            repeat 70 {
                sw *= 1.19;
                change_fisheye_effect sw;
                clone_z += (sw_z - size()) / 5;
            }
        }
        if swtype == "b" {
            set_color_effect sw_c;
            sw = 10;
            clone_z = 0;
            set_fisheye_effect 0;
            switch_costume "1/2sw";
            clone_dir = sw_dir;
            repeat 70 {
                sw *= 1.19;
                change_fisheye_effect sw;
                clone_z += (sw_z - size()) / 5;
            }
        }
        delete_this_clone;
    }
}
on "Intro start" {
    wait_ 1;
    repeat 8 {
        clone_y = 0;
        clone_dir = 90;
        clone_z = 1;
        clone_ "chev", 1;
        wait 0.5;
        clone_x = 0;
        clone_y = 0;
        clone_dir = 90;
        clone_z = 1;
        clone_ "chev2", 1;
        wait 0.5;
    }
}
onclone {
    if id == "sw\u5f71" {
        if swtype == "a" {
            set_color_effect sw_c;
            set_ghost_effect 50;
            set_brightness_effect -100;
            sw = 10;
            clone_z = 0;
            cos_ = "sw";
            switch_costume "sw";
            set_fisheye_effect 0;
            repeat 70 {
                sw *= 1.19;
                change_fisheye_effect sw;
                clone_z += (sw_z - size()) / 5;
            }
        }
        if swtype == "b" {
            set_color_effect sw_c;
            set_ghost_effect 50;
            set_brightness_effect -100;
            sw = 10;
            clone_z = 0;
            switch_costume "1/2sw";
            cos_ = "1/2sw";
            set_fisheye_effect 0;
            clone_dir = sw_dir;
            repeat 70 {
                sw *= 1.19;
                change_fisheye_effect sw;
                clone_z += (sw_z - size()) / 5;
            }
        }
        delete_this_clone;
    }
}
onclone {
    if id == "rw" {
        set_color_effect rw_c;
        goto_front;
        set_ghost_effect 0;
        show;
        switch_costume "Filler (Size)";
        clone_z = 0;
        switch_costume "Diamond 1";
        repeat 15 {
            clone_z += (rw_siz - size()) / 7;
            next_costume;
        }
        repeat 7 {
            clone_z += (rw_siz - size()) / 4;
            next_costume;
            change_ghost_effect 1;
        }
        hide;
    }
}
proc rw2 x2, y2, dir2, z2, c {
    rw_c = $c;
    rw_siz = $z2;
    clone_dir = $dir2;
    clone_x = $x2;
    clone_y = $y2;
    cam_control = 1;
    id = "rw";
    clone;
    clone_x = $x2 + 25;
    clone_y = $y2 - 15;
    id = "rw\u5f71";
    clone;
}
onclone {
    if id == "rw\u5f71" {
        goto_front;
        go_backward 1;
        set_brightness_effect -100;
        set_ghost_effect 50;
        show;
        switch_costume "Filler (Size)";
        clone_z = 0;
        switch_costume "Diamond 1";
        repeat 15 {
            clone_z += (rw_siz - size()) / 7;
            next_costume;
        }
        repeat 7 {
            clone_z += (rw_siz - size()) / 4;
            next_costume;
            change_ghost_effect 1;
        }
        hide;
    }
}
on "Intro start" {}
proc fw_type2 x2, y2, z2, _13, color, _11 {
    clone_dir = 0;
    fw_color = $color;
    fw_type = $_11;
    clone_x = $x2;
    clone_y = $y2;
    clone_z = $z2;
    fw2 = 0;
    repeat $_13 {
        fw2 += 1;
        clone_dir += 360 / $_13;
        clone_ "fw", 1;
    }
    clone_x = $x2 + 25;
    clone_y = $y2 - 15;
    repeat $_13 {
        fw2 += 1;
        clone_dir += 360 / $_13;
        clone_ "fw\u5f71", 1;
    }
}
onclone {
    if id == "fw" {
        set_ghost_effect 0;
        goto_front;
        if fw_type == "a" {
            set_color_effect fw_color;
            switch_costume "le1";
            repeat 10 {
                next_costume;
            }
            repeat 2 {
                next_costume;
                change_ghost_effect 10;
            }
            delete_this_clone;
        }
        elif fw_type == "b" {
            if fw2 in fw3 {
                set_brightness_effect 100;
                set_color_effect fw_color;
                switch_costume "le1";
                repeat 10 {
                    next_costume;
                }
                repeat 2 {
                    next_costume;
                    change_ghost_effect 10;
                }
                delete_this_clone;
            }
            else {
                set_brightness_effect 0;
                set_color_effect fw_color;
                switch_costume "le1";
                repeat 10 {
                    next_costume;
                }
                repeat 2 {
                    next_costume;
                    change_ghost_effect 10;
                }
                delete_this_clone;
            }
        }
    }
}
on "Intro start" {
    delete fw3;
    insert 2 at fw3[1];
    insert 4 at fw3[2];
    insert 6 at fw3[3];
    insert 8 at fw3[4];
    insert 10 at fw3[5];
    insert 12 at fw3[6];
    insert 14 at fw3[7];
    insert 16 at fw3[8];
    insert 18 at fw3[9];
    insert 20 at fw3[10];
}
on "Intro start" {}
onclone {
    if id == "fw\u5f71" {
        set_brightness_effect -100;
        goto_front;
        go_backward fw2;
        switch_costume "le1";
        change_ghost_effect 50;
        repeat 10 {
            next_costume;
        }
        repeat 2 {
            next_costume;
            change_ghost_effect 10;
        }
        delete_this_clone;
    }
}
onclone {
    if id == "chev" {
        switch_costume "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e01";
        until false {
            clone_z += _7 * clone_z / 100;
            clone_dir = 90;
            clone_x = "";
            clone_y = "";
        }
    }
}
onclone {
    if id == "chev2" {
        switch_costume "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e01";
        set_brightness_effect 90;
        until false {
            clone_z += _7 * clone_z / 100;
            clone_dir = 90;
            clone_x = "";
            clone_y = "";
        }
    }
}
on "Intro start" {
    _7 = 10;
}
on "Intro start" {
    wait_ 8;
    fw_type2 "", "", 100, 10, 125, "b";
    until round(x) == 180 {
        x += (180 - x) / 4;
    }
    fw_type2 180, "", 100, 10, 125, "b";
    until round(x) == -180 {
        x += (-180 - x) / 4;
    }
    fw_type2 -180, "", 100, 10, 125, "b";
    until round(x) == 0 {
        x += -x / 3;
    }
    sw_type_xydir_size_color "a", "", "", "", 100, 115;
    sw_type_xydir_size_color "a", 150, "", "", 100, 130;
    sw_type_xydir_size_color "a", -150, "", "", 100, 130;
    sw_type_xydir_size_color "a", "", 150, "", 100, 130;
    sw_type_xydir_size_color "a", 150, 150, "", 100, 115;
    sw_type_xydir_size_color "a", -150, 150, "", 100, 115;
    sw_type_xydir_size_color "a", "", -150, "", 100, 130;
    sw_type_xydir_size_color "a", 150, -150, "", 100, 115;
    sw_type_xydir_size_color "a", -150, -150, "", 100, 115;
}
on "Intro start" {}
on "Intro start" {
    delete _8;
    insert 3.33 at _8[1];
    insert 4.29 at _8[2];
    insert 5 at _8[3];
    insert 5.74 at _8[4];
    insert 6.3 at _8[5];
    insert 6 at _8[6];
    insert 7.1 at _8[7];
    insert "" at _8[8];
    insert 8.2 at _8[9];
    insert 9.8 at _8[10];
    insert 10.5 at _8[11];
}
on "Intro start" {
    wait_ _8[1];
    _3 25, 90, "", "";
    wait_ _8[3];
    b;
    _3 25, 90, "", "";
    wait_ _8[4];
    _3 25, 90, "", "";
    wait_ _8[7];
    rw2 "", "", "", 100, 120;
    rw2 "", "", "", 200, 120;
    _3 25, 90, "", "";
    wait_ _8[11];
    _7 = 30;
}
on "Intro start" {
    wait_ _8[6];
    rw2 -200, "", 45, 50, 120;
    rw2 -100, "", 45, 50, 120;
    rw2 "", "", 45, 50, 120;
    rw2 100, "", 45, 50, 120;
    rw2 200, "", 45, 50, 120;
    rw2 -200, 100, 45, 50, 120;
    rw2 -100, 100, 45, 50, 120;
    rw2 "", 100, 45, 50, 120;
    rw2 100, 100, 45, 50, 120;
    rw2 200, 100, 45, 50, 120;
    rw2 -200, 200, 45, 50, 120;
    rw2 -100, 200, 45, 50, 120;
    rw2 "", 200, 45, 50, 120;
    rw2 100, 200, 45, 50, 120;
    rw2 200, 200, 45, 50, 120;
    rw2 -200, -100, 45, 50, 120;
    rw2 -100, -100, 45, 50, 120;
    rw2 "", -100, 45, 50, 120;
    rw2 100, -100, 45, 50, 120;
    rw2 200, -100, 45, 50, 120;
    rw2 -200, -200, 45, 50, 120;
    rw2 -100, -200, 45, 50, 120;
    rw2 "", -200, 45, 50, 120;
    rw2 100, -200, 45, 50, 120;
    rw2 200, -200, 45, 50, 120;
    until round(dir) == 180 {
        dir += (180 - dir) / 3;
    }
    wait 0;
    until round(dir) == 360 {
        dir += (360 - dir) / 2.5;
    }
}
on "Intro start" {
    wait_ 8;
    dir = 0;
    a = 1;
    repeat 72 {
        dir += 5;
    }
}
onclone {
    show;
    if id == "g" {
        goto_front;
        set_size 100;
        switch_costume "g";
        goto -118, 0;
        sw_type_xydir_size_color "a", x_position(), 50, -90, 50, 120;
        until 5 < timer() {
            a2;
            goto sin(_4) * -118, cos(_4) * -118;
        }
        delete_this_clone;
    }
    if id == "o" {
        goto_front;
        set_size 100;
        switch_costume "o";
        goto -76, 0;
        sw_type_xydir_size_color "a", x_position(), -50, -90, 50, 120;
        until 4.5 < timer() {
            goto sin(_4) * -76, cos(_4) * -76;
        }
        delete_this_clone;
    }
    if id == "r" {
        goto_front;
        set_size 100;
        switch_costume "r";
        goto -31, "";
        sw_type_xydir_size_color "a", x_position(), 50, -90, 50, 120;
        until 4.5 < timer() {
            a2;
            goto sin(_4) * -31, cos(_4) * -31;
        }
        delete_this_clone;
    }
    if id == "i" {
        goto_front;
        set_size 100;
        switch_costume "i";
        goto 3, "";
        sw_type_xydir_size_color "a", x_position(), -50, -90, 50, 120;
        until 4.5 < timer() {
            a2;
            goto sin(_4) * 3, cos(_4) * 3;
        }
        delete_this_clone;
    }
    if id == "r2" {
        goto_front;
        set_size 100;
        switch_costume "r2";
        goto 40, "";
        sw_type_xydir_size_color "a", x_position(), 50, -90, 50, 120;
        until 4.5 < timer() {
            a2;
            goto sin(_4) * 40, cos(_4) * 40;
        }
        delete_this_clone;
    }
    if id == "a" {
        goto_front;
        set_size 100;
        switch_costume "a";
        goto 83, "";
        sw_type_xydir_size_color "a", x_position(), -50, -90, 50, 120;
        until 4.5 < timer() {
            a2;
            goto sin(_4) * 83, cos(_4) * 83;
        }
        delete_this_clone;
    }
    if id == "f" {
        goto_front;
        set_size 100;
        goto 123, "";
        sw_type_xydir_size_color "a", x_position(), 50, -90, 50, 120;
        switch_costume "f";
        until 4.5 < timer() {
            a2;
            goto sin(_4) * 123, cos(_4) * 123;
        }
        delete_this_clone;
    }
}
on "Intro start" {
    b = 1;
    wait_ 4;
    _4 = 90;
    clone_ "g", "";
    clone_ "o", "";
    clone_ "r", " ";
    clone_ "i", " ";
    clone_ "r2", " ";
    clone_ "a", " ";
    clone_ "f", " ";
    repeat 18 {
        _4 += 20;
    }
}
nowarp proc a2 {}
onclone {
    wait_ 10.4;
    if not ("le" in costume_name() or costume_name() == "text" or false) {
        repeat 4 {
            change_brightness_effect 25;
            change_ghost_effect 25;
        }
        delete_this_clone;
    }
}
onclone {
    if id == "text" {
        forever {
            goto_front;
        }
    }
}
nowarp proc _12 {
    _2 = 5;
    repeat 35 {
        _2 *= 1.12;
        clone_y += _2 - _2 * 2.01;
        turn_right _2 / 3;
    }
    delete_this_clone;
}
nowarp proc b {
    sw_type_xydir_size_color "a", "", "", 90, 100, 120;
    sw_type_xydir_size_color "a", "", "", 90, 200, 120;
}
on "Intro start" {
    play_sound_until_done "Catch Me (Wy Flip)";
    wait 2;
    broadcast "\u30a4\u30f3\u30c8\u30ed\u5b8c";
}
