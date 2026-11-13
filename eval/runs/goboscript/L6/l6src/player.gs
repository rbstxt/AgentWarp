set_y -61;
costumes "assets/costume1.svg";
sounds "assets/pop.wav";
var x = "0";
var y = -61;
var speed_y = "0";
var in_air = "0";
onflag {
    broadcast_and_wait "green flag";
    broadcast_and_wait "play game";
}
on "play game" {
    level = 1;
    forever {
        broadcast_and_wait "Reset";
        broadcast_and_wait "Setup";
        game_on;
        until false {
            tick;
            scroll_x = x;
            position;
            broadcast_and_wait "tick";
        }
    }
}
nowarp proc game_on {
    x = 0;
    y = 0;
    speed_y = 0;
    in_air = 0;
    show;
}
proc tick {
    if key_pressed("right arrow") {
        change_player_x_by 10;
    }
    if key_pressed("left arrow") {
        change_player_x_by -10;
    }
    if key_pressed("up arrow") {
        if in_air < 4 {
            speed_y = 17;
        }
    }
    speed_y += -2;
    change_player_y_by speed_y;
}
nowarp proc change_player_y_by sy {
    y += $sy;
    in_air += 1;
    position;
    until not touching("platforms") {
        if $sy > 0 {
            y += -1;
        }
        else {
            y += 1;
            in_air = 0;
        }
        position;
        speed_y = 0;
    }
}
nowarp proc position {
    goto x - scroll_x, y - scroll_y;
}
nowarp proc change_player_x_by sx {
    x += $sx;
    position;
    if touching("platforms") {
        repeat 16 {
            y += 1;
            position;
            if not touching("platforms") {
                stop_this_script;
            }
        }
        y += -16;
        until not touching("platforms") {
            if $sx > 0 {
                x += -1;
            }
            else {
                x += 1;
            }
            position;
        }
    }
}
