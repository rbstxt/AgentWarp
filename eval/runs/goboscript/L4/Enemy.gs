costumes "assets/enemy.svg";

onflag {
    goto 200, 230;
    hide;
    forever {
        wait 1;
        clone;
    }
}

onclone {
    show;
    goto random(-210, 210), 160;
    until y_position() < -150 {
        change_y -4;
        if touching("Bullet") {
            score++;
            delete_this_clone;
        }
    }
    lives--;
    if lives == 0 {
        broadcast "game over";
    }
    delete_this_clone;
}
