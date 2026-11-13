hide;
set_x 365;
set_y 0.4281136117560891;
costumes "assets/1.svg", "assets/2.svg", "assets/3.svg", "assets/next.svg", "assets/4.svg", "assets/5.svg", "assets/6.svg", "assets/\u2661.svg", "assets/\u2661.svg" as "\ud83d\udc64", "assets/\u2661.svg" as "\u2606";
sounds "assets/High Whoosh.wav", "assets/Finger Snap.wav";
onclone {
    if costume_name() == 1 or (costume_name() == 2 or (costume_name() == 3 or costume_name() == "next")) {
        set_brightness_effect 0;
        goto_front;
        set_x -465;
        set_y 0;
        show;
        until round(x_position()) == 0 {
            change_x -x_position() / 4;
        }
        wait 0.9;
        delete_this_clone;
    }
    if costume_name() == 4 or (costume_name() == 5 or costume_name() == 6) {
        goto_front;
        change_color_effect 10;
        set_x 0;
        set_y 345;
        show;
        until round(y_position()) == 0 {
            change_y -y_position() / 4;
        }
    }
    if costume_name() == "\u2606" or (costume_name() == "\u2661" or costume_name() == "\ud83d\udc64") {
        set_color_effect 0;
        goto_front;
        set_x 0;
        set_y 345;
        show;
        until round(y_position()) == 0 {
            change_y -y_position() / 4;
        }
    }
    if costume_name() == 4 {
        wait 0.3;
        until 464 < x_position() {
            change_x 1 + x_position() / 3;
        }
        delete_this_clone;
    }
    if costume_name() == 5 {
        wait 0.2;
        until 464 < x_position() {
            change_x 1 + x_position() / 3;
        }
        delete_this_clone;
    }
    if costume_name() == 6 {
        wait 0.1;
        until 464 < x_position() {
            change_x 1 + x_position() / 3;
        }
        delete_this_clone;
    }
    if costume_name() == "\u2661" {
        wait 0.2;
        until 319 < x_position() {
            change_x 1 + x_position() / 3;
        }
        delete_this_clone;
    }
    if costume_name() == "\ud83d\udc64" {
        wait 0.125;
        until 360 < x_position() {
            change_x 1 + x_position() / 3;
        }
        delete_this_clone;
    }
    if costume_name() == "\u2606" {
        wait 0.2;
        until 185 < x_position() {
            change_x 1 + x_position() / 3;
        }
        delete_this_clone;
    }
}
nowarp proc _14 _15 {
    switch_costume $_15;
    clone;
}
on "\u6b21\u306e\u30b9\u30c6\u30fc\u30b8" {
    hide;
    start_sound "High Whoosh";
    _14 1;
    wait 0.15;
    _14 2;
    wait 0.15;
    _14 3;
    wait 0.15;
    _14 "next";
    wait 0.45;
    _14 5;
    wait 0.15;
    _14 6;
    start_sound "Finger Snap";
    wait 0.15;
    _14 7;
    _14 "\u2606";
    _14 "\u2661";
    _14 "\ud83d\udc64";
    change_color_effect 15;
}
onflag {
    set_color_effect random(-200, 200);
}
