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
  setLookEffectTo("brightness", -25);
  show();
  switchCostumeTo("variant1-1");
  ifThen(equals(vars["Local Data"], "1"), () => { switchCostumeTo("variant1-1"); });
  forever(() => {
    waitUntil(touching("Hitbox"));
    switchCostumeTo("variant1-2");
    startSound("SYS-TIGGER-JP");
    broadcast("spring!");
    waitUntil(not(touching("Hitbox")));
    waitUntil(touching("Hitbox"));
    switchCostumeTo("variant1-1");
    waitUntil(not(touching("Hitbox")));
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
