costumes "assets/gameover.svg";

onflag {
    hide;
}

on "game over" {
    goto 0, 0;
    show;
    stop_all;
}
