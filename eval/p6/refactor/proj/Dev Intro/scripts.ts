// @a1
comment("Written on 2026-08-15 0:34 AM (GMT+7)\n\nThis took 6 hours when it was only supposed to take 2! Had a bunch of trouble getting the font to work, which cost me a lot of time, but I’m super happy with how it turned out!\n\nFont used: NicoPaint by NicoGuy\nArt: firstject");

// @a2
whenFlagClicked(() => {
  setVariableTo(vars._CloneID, "0");
  hide();
  call("initialize intro with %s unique clones", "6");
  call("wait %s frames", "81");
  broadcast("fadeblack - fast");
  repeat("19", () => {});
  broadcast("DevIntro_Completed");
  broadcast("mainmenu");
});

// @a3
whenBroadcastReceived("DevIntro_Completed", () => { deleteThisClone(); });

// @a4
whenStartAsClone(() => {
  ifThen(equals(vars._CloneID, "1"), () => { call("clone - screenfade"); });
  ifThen(equals(vars._CloneID, "2"), () => { call("clone - background"); });
  ifThen(equals(vars._CloneID, "3"), () => { call("clone - intro text"); });
  ifThen(equals(vars._CloneID, "4"), () => { call("clone - Mochi EXE"); });
  ifThen(equals(vars._CloneID, "5"), () => { call("clone - snooze 1"); });
  ifThen(equals(vars._CloneID, "6"), () => { call("clone - snooze 2"); });
});

// @a5
define("initialize intro with %s unique clones", { warp: true, argumentDefaults: ["", ""] }, (Clones) => {
    setVariableTo(vars._CloneID, "0");
    repeat(Clones, () => {
      changeVariableBy(vars._CloneID, "1");
      createCloneOf("_myself_");
    });
    setVariableTo(vars._CloneID, "0");
  });

// @a6
define("clone - intro text", () => {
    switchCostumeTo("nicopaint-1");
    setSizeTo("100");
    goToXY("-32", "0");
    show();
  });

// @a7
define("clone - Mochi EXE", { argumentDefaults: [""] }, () => {
    goToXY("80", "8");
    switchCostumeTo("MochiEXE_intro1");
    setSizeTo("200");
    show();
    call("wait %s frames", "32");
    switchCostumeTo("MochiEXE_intro2");
    setVariableTo(vars._MovementY, "10");
    repeat("6", () => {
      changeY(vars._MovementY);
      changeVariableBy(vars._MovementY, "-4");
    });
    switchCostumeTo("MochiEXE_intro3");
    call("wait %s frames", "2");
    switchCostumeTo("MochiEXE_intro4");
    call("wait %s frames", "10");
    switchCostumeTo("MochiEXE_intro5");
    call("wait %s frames", "4");
    repeat("4", () => {
      switchCostumeTo("MochiEXE_intro6");
      call("wait %s frames", "3");
      switchCostumeTo("MochiEXE_intro7");
      call("wait %s frames", "2");
    });
    call("wait %s frames", "2");
    forever(() => {
      switchCostumeTo("MochiEXE_intro8");
      call("wait %s frames", "1");
      switchCostumeTo("MochiEXE_intro9");
      call("wait %s frames", "3");
      switchCostumeTo("MochiEXE_intro8");
      call("wait %s frames", "1");
      switchCostumeTo("MochiEXE_intro7");
      call("wait %s frames", "90");
    });
  });

// @a8
define("wait %s frames", (Frame) => {
    repeat(Frame, () => {});
  });

// @a9
define("snooze move up", () => {
    repeat("4", () => { changeY("1"); });
  });

// @a10
define("snooze move down", () => {
    repeat("4", () => { changeY("-1"); });
  });

// @a11
define("clone - background", () => {
    goToFrontBack("back");
    goToXY("0", "0");
    switchCostumeTo("background");
    show();
    forever(() => { turnRight("0"); });
  });

// @a12
define("clone - screenfade", () => {
    goToFrontBack("front");
    goToXY("0", "0");
    switchCostumeTo("screen_fade");
    setLookEffectTo("GHOST", "0");
    show();
    call("wait %s frames", "10");
    repeat("20", () => { changeLookEffectBy("GHOST", "5"); });
    deleteThisClone();
  });

// @a13
define("clone - snooze 1", { argumentDefaults: [""] }, () => {
    switchCostumeTo("zz");
    show();
    goToXY("112", "42");
    call("snooze move down");
    call("snooze move up");
    call("snooze move down");
    call("snooze move up");
    call("snooze move down");
    call("snooze move up");
    call("snooze move down");
    call("snooze move up");
    deleteThisClone();
  });

// @a14
define("clone - snooze 2", () => {
    switchCostumeTo("z");
    show();
    goToXY("128", "42");
    call("snooze move up");
    call("snooze move down");
    call("snooze move up");
    call("snooze move down");
    call("snooze move up");
    call("snooze move down");
    call("snooze move up");
    call("snooze move down");
    deleteThisClone();
  });
