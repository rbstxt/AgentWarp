hide;
set_x 155;
set_y -3;
set_size 50;
point_in_direction -96.21279722652264;
costumes "assets/costume1 (2).svg" as "costume1";
sounds "assets/pop.wav";
onflag {
    hide;
    forever {
        clone;
    }
}
onclone {
    show;
    goto_mouse_pointer;
    repeat 10 {
        change_size 5;
    }
    delete_this_clone;
}
