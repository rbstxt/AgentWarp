// @a1
whenFlagClicked(() => {
  setVariableTo(vars.Data, 0);
  setVariableTo(vars["Local Type"], "1");
  hide();
});

// @a2
whenStartAsClone(() => {
  call("QuickDelete");
  setLookEffectTo("ghost", 50);
  switchCostumeTo("variant2");
  changeY(-5);
  goForwardBackwardLayers("backward", 333);
  show();
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
  ifThen(equals(vars.Tile, "11"), () => { deleteThisClone(); });
  ifThen(equals(vars.Tile, "19"), () => { setLookEffectTo("ghost", 100); });
  ifThen(equals(vars.Tile, "26"), () => { deleteThisClone(); });
});
