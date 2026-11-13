costumes "assets/ball.svg";

onflag {
    goto -100, 100;
    point_in_direction 45;
    forever {
        move 8;
        if_on_edge_bounce;
    }
}
