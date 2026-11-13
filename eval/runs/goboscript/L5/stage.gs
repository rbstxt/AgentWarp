costumes "assets/blank.svg";

# Level data: each platform is 4 consecutive items (center_x, center_y, width, height).
list platforms;
# Camera offset: screen_x = world_x - scrollX.
var scrollX = 0;
# Active level number.
var level = 1;

# Load level 1 geometry on green flag.
onflag {
    level = 1;
    scrollX = 0;
    broadcast "level 1";
}

# Level 1 platforms: full-width ground plus two floating platforms.
on "level 1" {
    level = 1;
    delete platforms;
    add 0 to platforms;
    add -150 to platforms;
    add 960 to platforms;
    add 20 to platforms;
    add 100 to platforms;
    add -60 to platforms;
    add 120 to platforms;
    add 16 to platforms;
    add -150 to platforms;
    add 10 to platforms;
    add 100 to platforms;
    add 16 to platforms;
}

# Level 2 platforms: ground plus a staircase of platforms.
on "level 2" {
    level = 2;
    delete platforms;
    add 0 to platforms;
    add -150 to platforms;
    add 960 to platforms;
    add 20 to platforms;
    add 150 to platforms;
    add 0 to platforms;
    add 100 to platforms;
    add 16 to platforms;
    add -50 to platforms;
    add -40 to platforms;
    add 140 to platforms;
    add 16 to platforms;
}
