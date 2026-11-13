// @a1
whenFlagClicked(() => { hide(); });

// @a2
whenBroadcastReceived("enter game", () => {
  setLookEffectTo("ghost", 100);
  setVariableTo(vars["Glide Y"], "0");
  setVariableTo(vars["Glide Left"], 0);
  setVariableTo(vars["Glide Right"], 0);
  setVariableTo(vars["Player Dir"], "2");
  setVariableTo(vars["Local NextMap?"], 0);
  setVariableTo(vars["Map ScrollFinished?"], 0);
  setVariableTo(vars["AlreadyDon?"], 0);
  setVariableTo(vars["Player TouchWater?"], 0);
  setVariableTo(vars["Saved InWater"], 0);
  setVariableTo(vars["Landing?"], "0");
  goToXY(-161, -82);
  switchCostumeTo("LightBlock Size");
  show();
  repeat(100, () => {});
  forever(() => {
    waitUntil(equals(vars.Paused, 0));
    setVariableTo(vars["Local Attempts"], 0);
    setVariableTo(vars["Tile to Move"], 0);
    call("CheckCollison");
    call("CheckTouchTile? Left");
    call("CheckTouchTile? Right");
    call("NextMap?");
  });
});

// @a3
define("NextMap?", () => {
    ifThen(equals(vars["Local NextMap?"], "1"), () => {
      ifThen(equals(vars["Next?"], "1"), () => {
        glideSecsToXY(0.8, -216, yPosition());
        setVariableTo(vars["Local NextMap?"], 0);
        setVariableTo(vars["Map ScrollFinished?"], "1");
        broadcast("done");
        setVariableTo(vars["Saved X"], xPosition());
        setVariableTo(vars["Saved Y"], yPosition());
        setVariableTo(vars["Saved Glide Y"], vars["Glide Y"]);
        setVariableTo(vars["Saved Glide Left"], vars["Glide Left"]);
        setVariableTo(vars["Saved Glide Right"], vars["Glide Right"]);
        setVariableTo(vars["Saved Jump"], vars.Jump);
      });
      ifThen(equals(vars["Next?"], "-1"), () => {
        glideSecsToXY(0.8, 216, yPosition());
        setVariableTo(vars["Local NextMap?"], 0);
        setVariableTo(vars["Map ScrollFinished?"], "1");
        broadcast("done");
        setVariableTo(vars["Saved X"], xPosition());
        setVariableTo(vars["Saved Y"], yPosition());
        setVariableTo(vars["Saved Glide Y"], vars["Glide Y"]);
        setVariableTo(vars["Saved Glide Left"], vars["Glide Left"]);
        setVariableTo(vars["Saved Glide Right"], vars["Glide Right"]);
        setVariableTo(vars["Saved Jump"], vars.Jump);
      });
      ifThen(equals(vars["Next?"], "2"), () => {
        glideSecsToXY(0.8, xPosition(), 156);
        setVariableTo(vars["Local NextMap?"], 0);
        setVariableTo(vars["Map ScrollFinished?"], "1");
        broadcast("done");
        setVariableTo(vars["Saved X"], xPosition());
        setVariableTo(vars["Saved Y"], yPosition());
        setVariableTo(vars["Saved Glide Y"], vars["Glide Y"]);
        setVariableTo(vars["Saved Glide Left"], vars["Glide Left"]);
        setVariableTo(vars["Saved Glide Right"], vars["Glide Right"]);
        setVariableTo(vars["Saved Jump"], vars.Jump);
      });
      ifThen(equals(vars["Next?"], "-2"), () => {
        glideSecsToXY(0.8, xPosition(), -156);
        setVariableTo(vars["Local NextMap?"], 0);
        setVariableTo(vars["Map ScrollFinished?"], "1");
        broadcast("done");
        setVariableTo(vars["Saved X"], xPosition());
        setVariableTo(vars["Saved Y"], yPosition());
        setVariableTo(vars["Saved Glide Y"], vars["Glide Y"]);
        setVariableTo(vars["Saved Glide Left"], vars["Glide Left"]);
        setVariableTo(vars["Saved Glide Right"], vars["Glide Right"]);
        setVariableTo(vars["Saved Jump"], vars.Jump);
      });
      call("TweakBug 13");
    });
  });

// @a4
whenBroadcastReceived("tryagain!", () => {
  setX(vars["Saved X"]);
  setY(vars["Saved Y"]);
  setVariableTo(vars["Glide Y"], vars["Saved Glide Y"]);
  setVariableTo(vars["Glide Left"], vars["Saved Glide Left"]);
  setVariableTo(vars["Glide Right"], vars["Saved Glide Right"]);
  setVariableTo(vars.Jump, vars["Saved Jump"]);
  setVariableTo(vars["Landing?"], vars.Jump);
});

// @a5
whenBroadcastReceived("next", () => { setVariableTo(vars["Local NextMap?"], "1"); });

// @a6
define("TouchWater? L %n", { warp: true }, (X = 1) => {
    ifElse(touching("Object - Water"), () => { changeVariableBy(vars["Glide Left"], divide(X, 2)); }, () => { changeVariableBy(vars["Glide Left"], X); });
  });

// @a7
define("TouchWater? R %n", { warp: true }, (X = 1) => {
    ifElse(touching("Object - Water"), () => { changeVariableBy(vars["Glide Right"], divide(X, 2)); }, () => { changeVariableBy(vars["Glide Right"], X); });
  });

// @a8
define("Glide Left LimitedWater", { warp: true }, () => {
    ifElse(touching("Object - Water"), () => {
      ifThen(greaterThan(vars["Glide Left"], "3"), () => { setVariableTo(vars["Glide Left"], "3"); });
      ifThen(lessThan(vars["Glide Left"], "0"), () => { setVariableTo(vars["Glide Left"], "0"); });
    }, () => {
      ifThen(greaterThan(vars["Glide Left"], "7"), () => { setVariableTo(vars["Glide Left"], "7"); });
      ifThen(lessThan(vars["Glide Left"], "0"), () => { setVariableTo(vars["Glide Left"], "0"); });
    });
  });

// @a9
define("Glide Right LimitedWater", { warp: true }, () => {
    ifElse(touching("Object - Water"), () => {
      ifThen(greaterThan(vars["Glide Right"], "3"), () => { setVariableTo(vars["Glide Right"], "3"); });
      ifThen(lessThan(vars["Glide Right"], "0"), () => { setVariableTo(vars["Glide Right"], "0"); });
    }, () => {
      ifThen(greaterThan(vars["Glide Right"], "7"), () => { setVariableTo(vars["Glide Right"], "7"); });
      ifThen(lessThan(vars["Glide Right"], "0"), () => { setVariableTo(vars["Glide Right"], "0"); });
    });
  });

// @a10
define("TouchWater? %n", { warp: true }, (Value = 1) => {
    ifElse(touching("Object - Water"), () => {
      ifElse(equals(vars.Jump, "0"), () => { changeVariableBy(vars["Glide Y"], divide(Value, 1.6)); }, () => { changeVariableBy(vars["Glide Y"], divide(Value, 2)); });
      setVariableTo(vars["Player TouchWater?"], "1");
    }, () => {
      changeVariableBy(vars["Glide Y"], Value);
      setVariableTo(vars["Player TouchWater?"], 0);
    });
  });

// @a11
whenBroadcastReceived("fireout", () => { setX(87); });

// @a12
whenBroadcastReceived("mainmenu", () => { goToXY(0, -83); });

// @a13
whenBroadcastReceived("win!", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  glideSecsToXY(0.3, 11, 4);
  broadcast("flashwhite");
  glideSecsToXY(2, 22, 8);
  repeat(50, () => {});
  broadcast("gameend");
  hide();
});

// @a14
whenBroadcastReceived("gameend", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  hide();
  deleteThisClone();
});

// @a15
define("CheckTouchTile? Left", { warp: true }, () => {
    ifThen(touching("Tile"), () => {
      changeX(1);
      setVariableTo(vars["Glide Left"], 0);
    });
    changeVariableBy(vars["Local Attempts"], 1);
    ifThen(greaterThan(vars["Local Attempts"], "300"), () => { stop("all"); });
  });

// @a16
define("CheckTouchTile? Right", { warp: true }, () => {
    ifThen(touching("Tile"), () => {
      changeX(-1);
      setVariableTo(vars["Glide Right"], 0);
    });
    changeVariableBy(vars["Local Attempts"], 1);
    ifThen(greaterThan(vars["Local Attempts"], "300"), () => { stop("all"); });
  });

// @a17
define("CheckCollison", { warp: true }, () => {
    ifThen(greaterThan(vars["Glide Y"], "-12"), () => {
      ifThen(not(or(or(keyPressed("up arrow"), keyPressed("w")), keyPressed("space"))), () => { ifThen(greaterThan(vars["Glide Y"], "0"), () => { call("TouchWater? %n", -2); }); });
      call("TouchWater? %n", -1.3);
    });
    ifThen(and(touching("Object - Water"), lessThan(vars["Glide Y"], "-4")), () => { setVariableTo(vars["Glide Y"], "-4"); });
    changeY(round(vars["Glide Y"]));
    ifThen(and(greaterThan(vars["Glide Y"], "0"), or(touching("Tile"), touching("Object - Wood Platform"))), () => {
      repeatUntil(not(or(touching("Tile"), touching("Object - Wood Platform"))), () => {
        changeY(-1);
        changeVariableBy(vars["Local Attempts"], 1);
        ifThen(greaterThan(vars["Local Attempts"], "300"), () => {
          setVariableTo(vars.Data, join("301", join("y-1", join("T0", vars.Tile))));
          broadcast("error");
          stop("all");
        });
      });
      setVariableTo(vars["Glide Y"], "0");
    });
    ifThen(or(touching("Tile"), touching("Object - Wood Platform")), () => {
      setVariableTo(vars["Glide Y"], 0);
      setVariableTo(vars.Jump, 0);
      ifThen(and(not(touching("Object - Water")), equals(vars["Landing?"], "1")), () => {
        startSound("Landing");
        setVariableTo(vars["Landing?"], "0");
      });
    });
    ifThen(lessThan(vars["Glide Y"], "-0.7"), () => { setVariableTo(vars.Jump, "1"); });
    ifThen(lessThan(vars["Glide Y"], "-1.4"), () => { setVariableTo(vars["Landing?"], "1"); });
    repeatUntil(not(or(touching("Tile"), touching("Object - Wood Platform"))), () => {
      changeY(1);
      changeVariableBy(vars["Local Attempts"], 1);
      ifThen(greaterThan(vars["Local Attempts"], "300"), () => {
        setVariableTo(vars.Data, join(join(join("x", xPosition()), join("y", yPosition())), join("T", vars.Tile)));
        broadcast("error");
        stop("all");
      });
    });
    ifElse(or(keyPressed("left arrow"), keyPressed("a")), () => {
      call("TouchWater? L %n", 1);
      setVariableTo(vars["Player Dir"], "1");
      repeat(vars["Glide Left"], () => {
        changeX(-1);
        call("CheckTouchTile? Left");
      });
      call("Glide Left LimitedWater");
    }, () => {
      ifThen(not(equals(vars["Glide Left"], "0")), () => {
        call("TouchWater? L %n", -1);
        repeat(vars["Glide Left"], () => {
          changeX(-1);
          call("CheckTouchTile? Left");
        });
      });
    });
    ifElse(or(keyPressed("right arrow"), keyPressed("d")), () => {
      call("TouchWater? R %n", 1);
      setVariableTo(vars["Player Dir"], "2");
      repeat(vars["Glide Right"], () => {
        changeX(1);
        call("CheckTouchTile? Right");
      });
      call("Glide Right LimitedWater");
    }, () => {
      ifThen(not(equals(vars["Glide Right"], "0")), () => {
        call("TouchWater? R %n", -1);
        repeat(vars["Glide Right"], () => {
          changeX(1);
          call("CheckTouchTile? Right");
        });
      });
    });
    ifThen(and(or(or(keyPressed("up arrow"), keyPressed("w")), keyPressed("space")), equals(vars.Jump, "0")), () => {
      call("TouchWater? %n", 17);
      setVariableTo(vars.Jump, "1");
      setVariableTo(vars["Landing?"], "1");
      ifElse(touching("Object - Water"), () => { startSound("WaterJump"); }, () => { startSound("Jump"); });
    });
    ifThen(equals(vars["Player TouchWater?"], "1"), () => {
      setVariableTo(vars["Local Random"], random(1, 35));
      ifThen(equals(vars["Local Random"], "33"), () => { createCloneOf("Object - Bubble"); });
    });
    ifThen(not(equals(vars["Saved InWater"], "0")), () => { changeVariableBy(vars["Saved InWater"], -1); });
    changeVariableBy(vars.Time, 1);
  });

// @a18
whenBroadcastReceived("spring!", () => {
  call("TouchWater? %n", 55);
  setVariableTo(vars.Jump, "1");
  setVariableTo(vars["Landing?"], "1");
});

// @a19
whenBroadcastReceived("enter game", () => {
  repeat(100, () => {});
  forever(() => {
    waitUntil(equals(vars["Player TouchWater?"], "1"));
    ifThen(equals(vars["Saved InWater"], "0"), () => {
      createCloneOf("Object - Water Effect");
      startSound("WaterLanding");
    });
    waitUntil(equals(vars["Player TouchWater?"], "0"));
    ifThen(equals(vars["Saved InWater"], "0"), () => {
      createCloneOf("Object - Water Effect");
      startSound("WaterLanding");
    });
  });
});

// @a20
define("TweakBug 13", () => {
    ifThen(and(equals(vars.Tile, "13"), equals(xPosition(), "98")), () => { changeX(2); });
  });

// --- 追加: リスタート時の掃除（物理ループ停止） ---
whenBroadcastReceived("restart", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  hide();
  deleteThisClone();
});
