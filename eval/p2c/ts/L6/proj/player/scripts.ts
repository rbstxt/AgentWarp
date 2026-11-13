// @a1
whenBroadcastReceived("play game", () => {
  setVariableTo(vars.LEVEL, "1");
  forever(() => {
    // @c1
    // this makes everything run!
    broadcastAndWait("Reset");
    broadcastAndWait("Setup");
    call("game on");
    repeatUntil(undefined, () => {
      call("tick");
      setVariableTo(vars["SCROLL X"], vars.x);
      call("position");
      broadcastAndWait("tick");
    });
  });
});

// @a2
define("change player y by %s", (sy) => {
    // @c2
    // this is so it stays on top of the ground
    changeVariableBy(vars.y, sy);
    changeVariableBy(vars["in air"], "1");
    call("position");
    repeatUntil(not(touching("platforms")), () => {
      ifElse(greaterThan(sy, "0"), () => { changeVariableBy(vars.y, "-1"); }, () => {
        changeVariableBy(vars.y, "1");
        setVariableTo(vars["in air"], "0");
        // Landing restores the double jump.
        setVariableTo(vars.jumps, "1");
      });
      call("position");
      setVariableTo(vars["speed y"], "0");
    });
  });

// @a3
define("tick", { warp: true }, () => {
    // Pause gate: freeze the whole game here with a PAUSED bubble until P resumes.
    ifThen(equals(vars.paused, 1), () => {
      say("PAUSED");
      waitUntil(not(equals(vars.paused, 1)));
    });
    ifThen(keyPressed("right arrow"), () => { call("change player x by %s", "10"); });
    // @c3
    // this code needs the play game code and the change player x by sx code to work
    ifThen(keyPressed("left arrow"), () => { call("change player x by %s", "-10"); });
    // Jump is 1.5x (25.5): grounded jump, plus one airborne double jump.
    // Edge-detected, so a held key cannot spend the air jump on the way up.
    ifThen(keyPressed("up arrow"), () => {
      ifThen(equals(vars.upHeld, 0), () => {
        setVariableTo(vars.upHeld, 1);
        // @c4
        // this makes it move and gives it gravity!
        ifThen(equals(vars["in air"], 0), () => {
          setVariableTo(vars["speed y"], "25.5");
          setVariableTo(vars.jumps, "1");
        });
        // Airborne double jump: allowed exactly once until the next landing.
        ifThen(and(greaterThan(vars["in air"], 0), greaterThan(vars.jumps, "0")), () => {
          setVariableTo(vars["speed y"], "25.5");
          changeVariableBy(vars.jumps, "-1");
        });
      });
    });
    ifThen(not(keyPressed("up arrow")), () => {
      setVariableTo(vars.upHeld, 0);
    });
    changeVariableBy(vars["speed y"], "-2");
    call("change player y by %s", vars["speed y"]);
  });

// @a4
define("game on", () => {
    // @c5
    // this sets all the variables to 0
    setVariableTo(vars.paused, "0");
    setVariableTo(vars.upHeld, "0");
    setVariableTo(vars.jumps, "1");
    setVariableTo(vars.x, "0");
    setVariableTo(vars.y, "0");
    setVariableTo(vars["speed y"], "0");
    setVariableTo(vars["in air"], "0");
    // Pause starts off and the air jump is ready (also reset here for replays).
    show();
  });

// @a5
define("change player x by %s", (sx) => {
    changeVariableBy(vars.x, sx);
    call("position");
    // @c6
    // this is wall detection
    ifThen(touching("platforms"), () => {
      repeat("16", () => {
        changeVariableBy(vars.y, "1");
        call("position");
        ifThen(not(touching("platforms")), () => { block("control_stop", { fields: { "STOP_OPTION": "this script" }, mutation: {"tagName":"mutation","children":[],"hasnext":"false"} }); });
      });
      changeVariableBy(vars.y, "-16");
      repeatUntil(not(touching("platforms")), () => {
        ifElse(greaterThan(sx, "0"), () => { changeVariableBy(vars.x, "-1"); }, () => { changeVariableBy(vars.x, "1"); });
        call("position");
      });
    });
  });

// @a6
script(() => {
  setVariableTo(vars["speed y"], "0");
});

// @a7
// @c7
// this is the position 
define("position", () => {
    goToXY(subtract(vars.x, vars["SCROLL X"]), subtract(vars.y, vars["SCROLL Y"]));
  });

// @a8
// @c8
// this tells it to start
whenFlagClicked(() => {
  broadcastAndWait("green flag");
  broadcastAndWait("play game");
});

// Pause toggle: P freezes the game (see the pause gate in tick) and shows
// PAUSED; pressing P again resumes and clears the bubble.
whenKeyPressed("p", () => {
  ifElse(equals(vars.paused, 1), () => {
    setVariableTo(vars.paused, 0);
    say("");
  }, () => {
    setVariableTo(vars.paused, 1);
  });
});
