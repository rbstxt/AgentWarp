costumes "assets/backdrop.svg", "assets/win.svg";

var score = 0;

onflag {
    score = 0;
    show score;
    switch_backdrop "backdrop";
}

on "win" {
    switch_backdrop "win";
}
