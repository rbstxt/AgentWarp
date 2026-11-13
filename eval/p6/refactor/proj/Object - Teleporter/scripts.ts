// @a1
whenFlagClicked(() => {
  setVariableTo(vars.Data, 0);
  hide();
});

// @a2
whenStartAsClone(() => {
  call("QuickDelete");
  changeVariableBy(vars.Data, 1);
  setLookEffectTo("ghost", 100);
  show();
  ifThen(equals(vars["Local Data"], "1"), () => { switchCostumeTo("variant1"); });
  ifThen(equals(vars["Local Data"], "2"), () => { switchCostumeTo("variant1"); });
  ifThen(equals(vars["Local Data"], "3"), () => { switchCostumeTo("variant2"); });
  ifThen(equals(vars["Local Data"], "4"), () => { switchCostumeTo("variant2"); });
  ifThen(equals(vars["Local Data"], "5"), () => { switchCostumeTo("variant2"); });
  ifThen(equals(vars["Local Data"], "6"), () => { switchCostumeTo("variant1"); });
  ifThen(equals(vars["Local Data"], "7"), () => { switchCostumeTo("variant1"); });
  repeat(10, () => {});
  waitUntil(touching("Hitbox"));
  ifThen(equals(vars["Local Data"], "1"), () => {
    setVariableTo(vars["Next?"], "1");
    changeVariableBy(vars.Tile, 1);
    setVariableTo(vars["Map ScrollFinished?"], 0);
    broadcast("next");
    changeVariableBy(vars.Data, -1);
  });
  ifThen(equals(vars["Local Data"], "2"), () => {
    setVariableTo(vars["Next?"], "-1");
    changeVariableBy(vars.Tile, -1);
    setVariableTo(vars["Map ScrollFinished?"], 0);
    broadcast("next");
    changeVariableBy(vars.Data, -1);
  });
  ifThen(equals(vars["Local Data"], "3"), () => {
    setVariableTo(vars["Next?"], "2");
    changeVariableBy(vars.Tile, 1);
    setVariableTo(vars["Map ScrollFinished?"], 0);
    broadcast("next");
    changeVariableBy(vars.Data, -1);
  });
  ifThen(equals(vars["Local Data"], "4"), () => {
    setVariableTo(vars["Next?"], "-2");
    changeVariableBy(vars.Tile, 1);
    setVariableTo(vars["Map ScrollFinished?"], 0);
    broadcast("next");
    changeVariableBy(vars.Data, -1);
  });
  ifThen(equals(vars["Local Data"], "5"), () => {
    setVariableTo(vars["Next?"], "2");
    changeVariableBy(vars.Tile, -1);
    setVariableTo(vars["Map ScrollFinished?"], 0);
    broadcast("next");
    changeVariableBy(vars.Data, -1);
  });
  ifThen(equals(vars["Local Data"], "6"), () => {
    setVariableTo(vars["Next?"], "-1");
    changeVariableBy(vars.Tile, 1);
    setVariableTo(vars["Map ScrollFinished?"], 0);
    broadcast("next");
    changeVariableBy(vars.Data, -1);
  });
  ifThen(equals(vars["Local Data"], "7"), () => {
    setVariableTo(vars["Next?"], "1");
    changeVariableBy(vars.Tile, -1);
    setVariableTo(vars["Map ScrollFinished?"], 0);
    broadcast("next");
    changeVariableBy(vars.Data, -1);
  });
  deleteThisClone();
});

// @a3
whenBroadcastReceived("next", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  deleteThisClone();
});

// @a4
whenBroadcastReceived("done", () => {
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
