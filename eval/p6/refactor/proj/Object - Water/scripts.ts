// @a1
whenFlagClicked(() => {
  setVariableTo(vars.Data, 0);
  setVariableTo(vars["Local Type"], "1");
  hide();
});

// @a2
whenStartAsClone(() => {
  ifThen(equals(vars["Local Type"], "1"), () => {
    call("QuickDelete");
    changeY(-5);
    setLookEffectTo("ghost", 75);
    show();
    ifThen(equals(vars["Local Data"], "1"), () => { switchCostumeTo("variant1"); });
    addToList("0", lists["Spawn Area X,Y"]);
    addToList("0", lists["Spawn Area X,Y"]);
    addToList("1", lists["Spawn Type"]);
    createCloneOf("Object - Water2");
    forever(() => {
      setVariableTo(vars["Local Glide"], 0);
      forever(() => {
        repeat(10, () => {
          changeVariableBy(vars["Local Glide"], -0.1);
          changeY(vars["Local Glide"]);
        });
        forever(() => {
          repeat(20, () => {
            changeVariableBy(vars["Local Glide"], 0.1);
            changeY(vars["Local Glide"]);
          });
          repeat(20, () => {
            changeVariableBy(vars["Local Glide"], -0.1);
            changeY(vars["Local Glide"]);
          });
        });
      });
    });
  });
});

// @a3
define("QuickDelete", { warp: true }, () => {
    goToXY(0, itemOfList(2, lists["Spawn Area X,Y"]));
    deleteOfList(1, lists["Spawn Area X,Y"]);
    deleteOfList(1, lists["Spawn Area X,Y"]);
    setVariableTo(vars["Local Data"], itemOfList(1, lists["Spawn Type"]));
    deleteOfList(1, lists["Spawn Type"]);
  });

// @a4
whenBroadcastReceived("next", () => {
  ifThen(equals(vars.Tile, "11"), () => {
    setVariableTo(vars["Water Present?"], 0);
    deleteThisClone();
  });
  ifThen(equals(vars.Tile, "19"), () => {
    switchCostumeTo("variant2");
    glideSecsToXY(0.8, 0, 240);
  });
  ifThen(equals(vars.Tile, "22"), () => {
    switchCostumeTo("variant2");
    glideSecsToXY(0.6, 0, 240);
  });
  ifThen(equals(vars.Tile, "23"), () => {
    switchCostumeTo("variant2");
    wait(0.2);
    glideSecsToXY(0.6, 0, 0);
  });
  ifThen(equals(vars.Tile, "26"), () => {
    setVariableTo(vars["Water Present?"], 0);
    deleteThisClone();
  });
});
