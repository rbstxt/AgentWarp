// @a1
whenFlagClicked(() => { hide(); });

// @a2
whenBroadcastReceived("enter game", () => {
  hide();
  setVariableTo(vars.Tile, "1");
  setVariableTo(vars["Next?"], 0);
  setVariableTo(vars["Local FromLR"], 0);
  setVariableTo(vars["Map ScrollFinished?"], "1");
  setVariableTo(vars["Water Present?"], 0);
  createCloneOf("_myself_");
  wait(0);
  forever(() => {
    waitUntil(equals(vars.Paused, 0));
    waitUntil(equals(vars["Map ScrollFinished?"], "1"));
    call("Part1");
    call("Part2");
    call("Part3");
    call("Part4");
    call("Part5");
    call("Part6");
    call("Part7");
    call("Part8");
    waitUntil(equals(vars["Map ScrollFinished?"], "0"));
  });
});

// @a3
define("Part2", () => {
    ifThen(equals(vars.Tile, "4"), () => {
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-61", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - KillZone");
      addToList("-11", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - KillZone");
      addToList("-124", lists["Spawn Area X,Y"]);
      addToList("-33", lists["Spawn Area X,Y"]);
      addToList("4", lists["Spawn Type"]);
      createCloneOf("Object - Sign");
    });
    ifThen(equals(vars.Tile, "5"), () => {
      addToList("-69", lists["Spawn Area X,Y"]);
      addToList("16", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - EventZone");
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("3", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("3", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
    });
    ifThen(equals(vars.Tile, "6"), () => {
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("25", lists["Spawn Area X,Y"]);
      addToList("23", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Torch");
      addToList("-94", lists["Spawn Area X,Y"]);
      addToList("36", lists["Spawn Area X,Y"]);
      addToList("3", lists["Spawn Type"]);
      createCloneOf("Object - Torch");
      addToList("-181", lists["Spawn Area X,Y"]);
      addToList("-158", lists["Spawn Area X,Y"]);
      addToList("4", lists["Spawn Type"]);
      createCloneOf("Object - Torch");
    });
    ifThen(equals(vars.Tile, "7"), () => {
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      ifThen(equals(vars["Water Present?"], "0"), () => {
        addToList("0", lists["Spawn Area X,Y"]);
        addToList("0", lists["Spawn Area X,Y"]);
        addToList("1", lists["Spawn Type"]);
        createCloneOf("Object - Water");
        setVariableTo(vars["Water Present?"], "1");
      });
      addToList("-75", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - KillZone");
      addToList("92", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - KillZone");
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
    });
  });

// @a4
whenBroadcastReceived("mainmenu", () => {
  switchCostumeTo("Lv1");
  goToXY(0, 0);
  goForwardBackwardLayers("backward", 999);
  show();
});

// @a5
whenBroadcastReceived("gameend", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  hide();
  deleteThisClone();
});

// @a6
whenStartAsClone(() => {
  switchCostumeTo(vars.Tile);
  ifElse(equals(vars["Local FromLR"], "1"), () => {
    goToXY(466, 0);
    show();
    glideSecsToXY(0.8, 0, 0);
  }, () => {
    ifElse(equals(vars["Local FromLR"], "2"), () => {
      goToXY(-466, 0);
      show();
      glideSecsToXY(0.8, 0, 0);
    }, () => {
      ifElse(equals(vars["Local FromLR"], "3"), () => {
        goToXY(0, -346);
        show();
        glideSecsToXY(0.8, 0, 0);
      }, () => {
        goToXY(0, 346);
        show();
        glideSecsToXY(0.8, 0, 0);
      });
    });
  });
  setVariableTo(vars["Map ScrollFinished?"], "1");
  waitUntil(or(or(equals(vars["Next?"], "1"), equals(vars["Next?"], "-1")), or(equals(vars["Next?"], "-2"), equals(vars["Next?"], "2"))));
  ifElse(equals(vars["Next?"], "1"), () => {
    setVariableTo(vars["Next?"], 0);
    setVariableTo(vars["Local FromLR"], "1");
    createCloneOf("_myself_");
    glideSecsToXY(0.78, -466, 0);
    deleteThisClone();
  }, () => {
    ifElse(equals(vars["Next?"], "-1"), () => {
      setVariableTo(vars["Next?"], "0");
      setVariableTo(vars["Local FromLR"], "2");
      createCloneOf("_myself_");
      glideSecsToXY(0.78, 466, 0);
      deleteThisClone();
    }, () => {
      ifElse(equals(vars["Next?"], "2"), () => {
        setVariableTo(vars["Next?"], 0);
        setVariableTo(vars["Local FromLR"], "3");
        createCloneOf("_myself_");
        glideSecsToXY(0.78, 0, 346);
        deleteThisClone();
      }, () => {
        setVariableTo(vars["Next?"], 0);
        setVariableTo(vars["Local FromLR"], "4");
        createCloneOf("_myself_");
        glideSecsToXY(0.78, 0, -346);
        deleteThisClone();
      });
    });
  });
});

// @a7
define("Part3", () => {
    ifThen(equals(vars.Tile, "8"), () => {
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("20", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - KillZone");
      addToList("100", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - KillZone");
    });
    ifThen(equals(vars.Tile, "9"), () => {
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-136", lists["Spawn Area X,Y"]);
      addToList("-120", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("-86", lists["Spawn Area X,Y"]);
      addToList("-120", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("-36", lists["Spawn Area X,Y"]);
      addToList("-120", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("14", lists["Spawn Area X,Y"]);
      addToList("-120", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("64", lists["Spawn Area X,Y"]);
      addToList("-120", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("114", lists["Spawn Area X,Y"]);
      addToList("-120", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("-40", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Wood Platform");
      addToList("-194", lists["Spawn Area X,Y"]);
      addToList("13", lists["Spawn Area X,Y"]);
      addToList("5", lists["Spawn Type"]);
      createCloneOf("Object - Sign");
    });
    ifThen(equals(vars.Tile, "10"), () => {
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("180", lists["Spawn Area X,Y"]);
      addToList("4", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-10", lists["Spawn Area X,Y"]);
      addToList("25", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - SpringBoard");
      ifThen(equals(vars["Water Present?"], "0"), () => {
        addToList("0", lists["Spawn Area X,Y"]);
        addToList("0", lists["Spawn Area X,Y"]);
        addToList("1", lists["Spawn Type"]);
        createCloneOf("Object - Water");
        setVariableTo(vars["Water Present?"], "1");
      });
      addToList("-59", lists["Spawn Area X,Y"]);
      addToList("25", lists["Spawn Area X,Y"]);
      addToList("6", lists["Spawn Type"]);
      createCloneOf("Object - Sign");
    });
  });

// @a8
define("Part1", () => {
    ifThen(equals(vars.Tile, "1"), () => {
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-125", lists["Spawn Area X,Y"]);
      addToList("-87", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Sign");
      addToList("-28", lists["Spawn Area X,Y"]);
      addToList("-58", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - EventZone");
    });
    ifThen(equals(vars.Tile, "2"), () => {
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-90", lists["Spawn Area X,Y"]);
      addToList("-87", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Sign");
    });
    ifThen(equals(vars.Tile, "3"), () => {
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-40", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - KillZone");
      addToList("31", lists["Spawn Area X,Y"]);
      addToList("-96", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Torch");
      addToList("-90", lists["Spawn Area X,Y"]);
      addToList("-87", lists["Spawn Area X,Y"]);
      addToList("3", lists["Spawn Type"]);
      createCloneOf("Object - Sign");
    });
  });

// @a9
define("Part4", () => {
    ifThen(equals(vars.Tile, "11"), () => {
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("5", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
    });
    ifThen(equals(vars.Tile, "12"), () => {
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-144", lists["Spawn Area X,Y"]);
      addToList("-124", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Torch");
      addToList("115", lists["Spawn Area X,Y"]);
      addToList("-79", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Torch");
      addToList("115", lists["Spawn Area X,Y"]);
      addToList("-129", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("-106", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - KillZone");
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - KillZone");
      addToList("-50", lists["Spawn Area X,Y"]);
      addToList("-115", lists["Spawn Area X,Y"]);
      addToList("7", lists["Spawn Type"]);
      createCloneOf("Object - Sign");
    });
    ifThen(equals(vars.Tile, "13"), () => {
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-62", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("-10", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("102", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("150", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("102", lists["Spawn Area X,Y"]);
      addToList("36", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - SpringBoard");
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("180", lists["Spawn Area X,Y"]);
      addToList("4", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("180", lists["Spawn Area X,Y"]);
      addToList("4", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
    });
  });

// @a10
define("Part5", () => {
    ifThen(equals(vars.Tile, "14"), () => {
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("120", lists["Spawn Area X,Y"]);
      addToList("-2", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Collectables");
      addToList("60", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - KillZone");
      addToList("-119", lists["Spawn Area X,Y"]);
      addToList("35", lists["Spawn Area X,Y"]);
      addToList("8", lists["Spawn Type"]);
      createCloneOf("Object - Sign");
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
    });
    ifThen(equals(vars.Tile, "15"), () => {
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("5", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("5", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
    });
    ifThen(equals(vars.Tile, "16"), () => {
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("85", lists["Spawn Area X,Y"]);
      addToList("-130", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      ifThen(equals(vars.Key, "0"), () => {
        addToList("147", lists["Spawn Area X,Y"]);
        addToList("41", lists["Spawn Area X,Y"]);
        addToList("2", lists["Spawn Type"]);
        createCloneOf("Object - Collectables");
      });
    });
    ifThen(equals(vars.Tile, "17"), () => {
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("3", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
    });
    ifThen(equals(vars.Tile, "18"), () => {
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("3", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Water");
    });
    ifThen(equals(vars.Tile, "19"), () => {
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("32", lists["Spawn Area X,Y"]);
      addToList("-178", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - KillZone");
      addToList("41", lists["Spawn Area X,Y"]);
      addToList("83", lists["Spawn Area X,Y"]);
      addToList("3", lists["Spawn Type"]);
      createCloneOf("Object - EventZone");
    });
  });

// @a11
define("Part6", () => {
    ifThen(equals(vars.Tile, "20"), () => {
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-52", lists["Spawn Area X,Y"]);
      addToList("-131", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("3", lists["Spawn Area X,Y"]);
      addToList("-131", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("96", lists["Spawn Area X,Y"]);
      addToList("-131", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("147", lists["Spawn Area X,Y"]);
      addToList("-131", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("-107", lists["Spawn Area X,Y"]);
      addToList("16", lists["Spawn Area X,Y"]);
      addToList("3", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("50", lists["Spawn Area X,Y"]);
      addToList("8", lists["Spawn Area X,Y"]);
      addToList("3", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
    });
    ifThen(equals(vars.Tile, "21"), () => {
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("32", lists["Spawn Area X,Y"]);
      addToList("-178", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - KillZone");
      addToList("-24", lists["Spawn Area X,Y"]);
      addToList("76", lists["Spawn Area X,Y"]);
      addToList("3", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("102", lists["Spawn Area X,Y"]);
      addToList("76", lists["Spawn Area X,Y"]);
      addToList("3", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
    });
    ifThen(equals(vars.Tile, "22"), () => {
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("180", lists["Spawn Area X,Y"]);
      addToList("4", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("32", lists["Spawn Area X,Y"]);
      addToList("-178", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - KillZone");
      addToList("-89", lists["Spawn Area X,Y"]);
      addToList("-121", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - SpringBoard");
      addToList("159", lists["Spawn Area X,Y"]);
      addToList("-40", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
    });
  });

// @a12
define("Part7", () => {
    ifThen(equals(vars.Tile, "23"), () => {
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("5", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("6", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
    });
    ifThen(equals(vars.Tile, "24"), () => {
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("7", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("49", lists["Spawn Area X,Y"]);
      addToList("-57", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Wood Platform");
      addToList("107", lists["Spawn Area X,Y"]);
      addToList("-128", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("56", lists["Spawn Area X,Y"]);
      addToList("-128", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("-9", lists["Spawn Area X,Y"]);
      addToList("-128", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("-71", lists["Spawn Area X,Y"]);
      addToList("-128", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("6", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
    });
    ifThen(equals(vars.Tile, "25"), () => {
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("7", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("180", lists["Spawn Area X,Y"]);
      addToList("4", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      ifThen(equals(vars["Water Present?"], "0"), () => {
        addToList("0", lists["Spawn Area X,Y"]);
        addToList("0", lists["Spawn Area X,Y"]);
        addToList("1", lists["Spawn Type"]);
        createCloneOf("Object - Water");
        setVariableTo(vars["Water Present?"], "1");
      });
      addToList("80", lists["Spawn Area X,Y"]);
      addToList("77", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - SpringBoard");
    });
  });

// @a13
define("Part8", () => {
    ifThen(equals(vars.Tile, "26"), () => {
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("5", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-240", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("6", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-67", lists["Spawn Area X,Y"]);
      addToList("-144", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
    });
    ifThen(equals(vars.Tile, "27"), () => {
      addToList("240", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("7", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("180", lists["Spawn Area X,Y"]);
      addToList("4", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("148", lists["Spawn Area X,Y"]);
      addToList("62", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - SpringBoard");
    });
    ifThen(equals(vars.Tile, "28"), () => {
      addToList("0", lists["Spawn Area X,Y"]);
      addToList("-180", lists["Spawn Area X,Y"]);
      addToList("5", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("137", lists["Spawn Area X,Y"]);
      addToList("-89", lists["Spawn Area X,Y"]);
      addToList("3", lists["Spawn Type"]);
      createCloneOf("Object - Torch");
    });
    ifThen(equals(vars.Tile, "29"), () => {
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
    });
    ifThen(equals(vars.Tile, "30"), () => {
      addToList("239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("137", lists["Spawn Area X,Y"]);
      addToList("-89", lists["Spawn Area X,Y"]);
      addToList("3", lists["Spawn Type"]);
      createCloneOf("Object - Torch");
      addToList("-67", lists["Spawn Area X,Y"]);
      addToList("-144", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
    });
    // Tile31 の配置。Stage の stage31test（テスト用直接スポーン）と内容を合わせること。
    ifThen(equals(vars.Tile, "31"), () => {
      addToList("-239", lists["Spawn Area X,Y"]);
      addToList("9", lists["Spawn Area X,Y"]);
      addToList("2", lists["Spawn Type"]);
      createCloneOf("Object - Teleporter");
      addToList("-45", lists["Spawn Area X,Y"]);
      addToList("-104", lists["Spawn Area X,Y"]);
      addToList("99", lists["Spawn Type"]);
      createCloneOf("Object - EventZone");
      addToList("100", lists["Spawn Area X,Y"]);
      addToList("-130", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Urchin");
      addToList("-100", lists["Spawn Area X,Y"]);
      addToList("60", lists["Spawn Area X,Y"]);
      addToList("1", lists["Spawn Type"]);
      createCloneOf("Object - Torch");
    });
  });

// --- 追加: リスタート時の掃除（スポーンループ停止＋クローン削除） ---
whenBroadcastReceived("restart", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  hide();
  deleteThisClone();
});
