// @a1
whenFlagClicked(() => {
  setVariableTo(vars.Data, 0);
  hide();
});

// @a2
whenStartAsClone(() => {
  call("QuickDelete");
  changeVariableBy(vars.Data, 1);
  goForwardBackwardLayers("backward", 999);
  show();
  pointInDirection(90);
  ifThen(equals(vars["Local Data3"], "1"), () => { switchCostumeTo("variant1"); });
  ifThen(equals(vars["Local Data3"], "2"), () => { switchCostumeTo("variant2"); });
  ifThen(equals(vars["Local Data3"], "3"), () => {
    switchCostumeTo("variant1");
    turnRight(180);
  });
  forever(() => {
    waitUntil(touching("Hitbox"));
    startSound("SYS-CARDLOSE");
    broadcast("tryagain!");
    setVariableTo(vars["Saved InWater"], "3");
    wait(0);
    wait(0);
  });
});

// @a3
whenStartAsClone(() => {
  ifThen(or(equals(vars["Local Data3"], "1"), equals(vars["Local Data3"], "3")), () => {
    forever(() => {
      setVariableTo(vars["Local Random"], random(1, 65));
      ifThen(equals(vars["Local Random"], "1"), () => {
        repeat(4, () => { nextCostume(); });
        repeat(4, () => { switchCostumeTo(subtract(costumeNumberName("number"), 1)); });
      });
    });
  });
});

// @a4
whenBroadcastReceived("done", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  deleteThisClone();
});

// @a5
whenBroadcastReceived("next", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  deleteThisClone();
});

// @a6
define("QuickDelete", { warp: true }, () => {
    goToXY(itemOfList(1, lists["Spawn Area X,Y"]), itemOfList(2, lists["Spawn Area X,Y"]));
    deleteOfList(1, lists["Spawn Area X,Y"]);
    deleteOfList(1, lists["Spawn Area X,Y"]);
    setVariableTo(vars["Local Data3"], itemOfList(1, lists["Spawn Type"]));
    deleteOfList(1, lists["Spawn Type"]);
  });
