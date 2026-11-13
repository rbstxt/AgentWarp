set_x 360;
costumes "assets/level 1 2.png", "assets/level 1 3.png";
sounds "assets/pop.wav";
var y = "0";
var x = "360";
on "tick" {
    position x - scroll_x, y - scroll_y;
}
on "Setup" {
    x = 0;
    y = 0;
    switch_costume "level 1 2";
    clone;
    x = 360;
    clone;
    x = 360;
    switch_costume "level 1 3";
}
nowarp proc position x, y {
    goto $x, $y;
    if $x == x_position() and $y == y_position() {
        show;
    }
    else {
        hide;
    }
}
