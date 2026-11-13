// @a1
whenFlagClicked(() => {
  setVariableTo(vars.Data, 0);
  setVariableTo(vars.Key, 0);
  hide();
});

// @a2
whenStartAsClone(() => {
  call("QuickDelete");
  changeVariableBy(vars.Data, 1);
  goForwardBackwardLayers("backward", 999);
  show();
  ifThen(equals(vars["Local Data"], "1"), () => {
    switchCostumeTo("Door Locked");
    ifThen(equals(vars.Key, "2"), () => { deleteThisClone(); });
    waitUntil(touching("Hitbox"));
    ifThen(equals(vars.Key, "0"), () => { forever(() => { ifThen(touching("Hitbox"), () => { broadcast("fireout"); }); }); });
    ifThen(equals(vars.Key, "1"), () => {
      switchCostumeTo("Door Opened");
      startSound("SYS-DOOR0");
      setVariableTo(vars.Key, "2");
      setVariableTo(vars["Local Data"], "11");
      repeat(20, () => {
        changeY(-1);
        changeLookEffectBy("ghost", 5);
      });
      deleteThisClone();
    });
  });
  ifThen(equals(vars["Local Data"], "11"), () => {
    switchCostumeTo("Door Opened");
    turnLeft(random(0, 35));
    repeat(10, () => {
      changeX(3);
      changeLookEffectBy("ghost", 10);
      changeY(4);
      turnRight(15);
    });
    deleteThisClone();
  });
  ifThen(equals(vars["Local Data"], "2"), () => {
    switchCostumeTo("Key");
    waitUntil(touching("Hitbox"));
    startSound("SYS-DOOR2");
    switchCostumeTo("Text");
    goToFrontBack("front");
    setVariableTo(vars["Local Glide"], "4");
    changeVariableBy(vars.Key, 1);
    repeat(10, () => {
      changeY(vars["Local Glide"]);
      changeVariableBy(vars["Local Glide"], -0.4);
    });
    wait(1);
    deleteThisClone();
  });
});

// @a3
whenBroadcastReceived("done", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  deleteThisClone();
});

// @a4
whenBroadcastReceived("next", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  deleteThisClone();
});

// @a5
define("QuickDelete", { warp: true }, () => {
    goToXY(itemOfList(1, lists["Spawn Area X,Y"]), itemOfList(2, lists["Spawn Area X,Y"]));
    deleteOfList(1, lists["Spawn Area X,Y"]);
    deleteOfList(1, lists["Spawn Area X,Y"]);
    setVariableTo(vars["Local Data"], itemOfList(1, lists["Spawn Type"]));
    deleteOfList(1, lists["Spawn Type"]);
  });
