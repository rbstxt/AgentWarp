costumes "assets/\u30b3\u30b9\u30c1\u30e5\u30fc\u30e04 (3).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e04", "assets/Filler (Size).svg" as "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e06";
sounds "assets/\u30dd\u30c3\u30d7.wav";
onflag {
    goto 0, 0;
    switch_costume "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e06";
    set_size 100;
    switch_costume "\u30b3\u30b9\u30c1\u30e5\u30fc\u30e04";
    forever {
        show;
        set_ghost_effect 100;
        goto_front;
    }
}
