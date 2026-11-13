costumes "assets/bullet.svg";

onflag {
    goto 0, 230;
    hide;
}

onclone {
    goto "Player"."x position", -120;
    show;
    until y_position() > 170 {
        change_y 12;
        if touching("Enemy") {
            delete_this_clone;
        }
    }
    delete_this_clone;
}
