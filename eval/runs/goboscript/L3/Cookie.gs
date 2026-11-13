costumes "assets/cookie.svg", "assets/cookie_pressed.svg";
sounds "assets/pop.wav";

onclick {
    score++;
    start_sound "pop";
    switch_costume "cookie_pressed";
    wait 0.1;
    switch_costume "cookie";
    if score == 10 {
        broadcast "win";
    }
}
