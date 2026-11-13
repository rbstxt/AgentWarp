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
  ifThen(equals(vars["Local Data2"], "1"), () => { switchCostumeTo("variant1"); });
  ifThen(equals(vars["Local Data2"], "2"), () => { switchCostumeTo("variant2"); });
  forever(() => {
    waitUntil(and(touching("Hitbox"), equals(vars["AlreadyDon?"], "0")));
    setVariableTo(vars["AlreadyDon?"], "1");
    repeat(2, () => {});
    setVariableTo(vars["AlreadyDon?"], 0);
    ifThen(or(equals(vars["Local Data2"], "1"), equals(vars["Local Data2"], "2")), () => {
      startSound("SYS-PO-FALL");
      broadcast("tryagain!");
      setVariableTo(vars["Saved InWater"], "3");
    });
    wait(0);
    wait(0);
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
    setVariableTo(vars["Local Data2"], itemOfList(1, lists["Spawn Type"]));
    deleteOfList(1, lists["Spawn Type"]);
  });
