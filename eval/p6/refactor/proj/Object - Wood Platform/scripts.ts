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
  ifThen(equals(vars["Local Data4"], "1"), () => {
    switchCostumeTo("variant1");
    forever(() => {
      changeY(6);
      call("CheckWater");
      changeY(-5);
    });
  });
  ifThen(equals(vars["Local Data4"], "2"), () => { switchCostumeTo("variant1"); });
});

// @a3
define("CheckWater", { warp: true }, () => {
    repeat(10, () => { ifThen(not(touching("Object - Water")), () => { changeY(-1); }); });
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
    setVariableTo(vars["Local Data4"], itemOfList(1, lists["Spawn Type"]));
    deleteOfList(1, lists["Spawn Type"]);
  });
