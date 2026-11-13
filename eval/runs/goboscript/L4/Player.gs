costumes "assets/player.svg";

onflag {
    goto 0, -140;
    show;
    forever {
        if key_pressed("left arrow") {
            change_x -6;
        }
        if key_pressed("right arrow") {
            change_x 6;
        }
        if key_pressed("space") {
            clone "Bullet";
            wait 0.25;
        }
    }
}
