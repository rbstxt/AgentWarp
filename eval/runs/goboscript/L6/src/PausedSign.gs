costumes "assets/paused.svg";

onflag {
    hide;
    goto 0, 150;
    forever {
        if paused == 1 {
            show;
        } else {
            hide;
        }
        wait 0.1;
    }
}
