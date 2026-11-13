costumes "assets/cat.svg";

onflag {
    goto 0, 0;
    forever {
        if key_pressed("right arrow") {
            change_x 5;
        }
        if key_pressed("left arrow") {
            change_x -5;
        }
        if key_pressed("up arrow") {
            change_y 5;
        }
        if key_pressed("down arrow") {
            change_y -5;
        }
    }
}
