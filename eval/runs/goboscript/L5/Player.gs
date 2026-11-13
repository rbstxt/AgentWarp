costumes "assets/player.svg";

# Axis-separated AABB collision against the platforms list.
# Runs without screen refresh so one game step stays atomic.
nowarp proc collide dx, dy {
    local hw = 14;
    local hh = 18;
    WX += $dx;
    local i = 1;
    until i > length platforms {
        local px = platforms[i];
        local py = platforms[i + 1];
        local pw = platforms[i + 2];
        local ph = platforms[i + 3];
        if WX + hw > px - pw / 2 and WX - hw < px + pw / 2 and WY + hh > py - ph / 2 and WY - hh < py + ph / 2 {
            if $dx > 0 {
                WX = px - pw / 2 - hw;
            }
            if $dx < 0 {
                WX = px + pw / 2 + hw;
            }
        }
        i += 4;
    }
    WY += $dy;
    onGround = false;
    local j = 1;
    until j > length platforms {
        local qx = platforms[j];
        local qy = platforms[j + 1];
        local qw = platforms[j + 2];
        local qh = platforms[j + 3];
        if WX + hw > qx - qw / 2 and WX - hw < qx + qw / 2 and WY + hh > qy - qh / 2 and WY - hh < qy + qh / 2 {
            if $dy <= 0 {
                WY = qy + qh / 2 + hh;
                vy = 0;
                onGround = true;
            } else {
                WY = qy - qh / 2 - hh;
                vy = 0;
            }
        }
        j += 4;
    }
}

# Main game loop: input, gravity, jump, collide, camera scroll.
onflag {
    show;
    WX = -200;
    WY = 100;
    vy = 0;
    onGround = false;
    forever {
        local mx = 0;
        if key_pressed("left arrow") {
            mx = -5;
        }
        if key_pressed("right arrow") {
            mx = 5;
        }
        vy -= 0.8;
        if vy < -14 {
            vy = -14;
        }
        if key_pressed("up arrow") and onGround {
            vy = 12;
            onGround = false;
        }
        collide mx, vy;
        scrollX = WX;
        if scrollX < -240 {
            scrollX = -240;
        }
        if scrollX > 240 {
            scrollX = 240;
        }
        goto WX - scrollX, WY;
        if WX > 460 {
            broadcast "level 2";
        }
    }
}

# Reset the player when a level loads.
on "level 1" {
    WX = -200;
    WY = 100;
    vy = 0;
}
# Reset the player when a level loads.
on "level 2" {
    WX = -200;
    WY = 120;
    vy = 0;
}

# Jump to level 2 with the L key.
onkey "l" {
    broadcast "level 2";
}
