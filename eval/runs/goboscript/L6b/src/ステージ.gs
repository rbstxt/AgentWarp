hide;
set_y -0.0010704357695294705;
costumes "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e01 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e01", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e02.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e03.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e04.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e05.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e06.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e07.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e08.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e09.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e010.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e011.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e012.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e013.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e014.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e015.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e016.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e018.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e017.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e019.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e020.svg", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e049.svg";
sounds "assets/\u30dd\u30c3\u30d7.wav";
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
onflag {
    _5 = 1;
    hide;
}
on "\u30a4\u30f3\u30c8\u30ed\u5b8c" {
    show;
    forever {
        switch_costume _5;
    }
}
on "\u30a4\u30f3\u30c8\u30ed\u5b8c" {
    goto 0, -75;
    repeat 50 {
        change_y -y_position() / 5;
    }
}
on "\u6b21\u306e\u30b9\u30c6\u30fc\u30b8" {
    taimu = 0;
    wait 1;
    _5 += 1;
}
onflag {
    hide world_record;
    hide time;
}
on "\u30a4\u30f3\u30c8\u30ed\u5b8c" {
    wait 1;
    forever {
        if _5 == 20 {
            if time < world_record {
                world_record = time;
            }
            wait 1;
            show world_record;
            show time;
            stop_this_script;
        }
        else {
            hide time;
            hide world_record;
        }
    }
}
on "\u30a4\u30f3\u30c8\u30ed\u5b8c" {
    wait 1;
    reset_timer;
    time = 0;
    until _5 == 20 {
        until 1 < timer() {
            if _5 == 20 {
                stop_this_script;
            }
        }
        time += 1;
        reset_timer;
    }
}

onflag {
    taimu = 0;
    show taimu;
    forever {
        wait 1;
        taimu += 1;
    }
}
