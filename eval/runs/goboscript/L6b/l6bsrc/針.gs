hide;
set_y -0.0010704357695294705;
costumes "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e01 (4).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e01", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e02 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e02", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e03 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e03", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e04 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e04", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e05 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e05", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e06 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e06", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e07 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e07", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e08 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e08", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e09 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e09", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e010 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e010", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e011 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e011", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e012 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e012", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e013 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e013", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e014 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e014", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e015 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e015", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e016 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e016", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e017 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e017", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e018 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e018", "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e019 (2).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e019", "assets/Filler (Size).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e020";
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
on "\u30a4\u30f3\u30c8\u30ed\u5b8c" {
    show;
    forever {
        switch_costume _5;
        goto_back;
    }
}
onflag {
    hide;
}
on "\u30a4\u30f3\u30c8\u30ed\u5b8c" {
    goto 0, -75;
    repeat 50 {
        change_y -y_position() / 5;
    }
}
