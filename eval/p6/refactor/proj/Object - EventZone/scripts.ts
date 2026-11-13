// @a1
whenFlagClicked(() => { hide(); });

// @a2
whenStartAsClone(() => {
  call("QuickDelete");
  changeVariableBy(vars.Data, 1);
  setLookEffectTo("ghost", 100);
  show();
  ifThen(equals(vars["Local Data"], "1"), () => {
    switchCostumeTo("variant1");
    waitUntil(touching("Hitbox"));
    goToXY(145, 35);
    switchCostumeTo("arrow");
    setVariableTo(vars["Local Glide"], "0");
    goToFrontBack("front");
    repeat(10, () => {
      changeLookEffectBy("ghost", -10);
      changeVariableBy(vars["Local Glide"], 0.6);
      changeX(vars["Local Glide"]);
    });
    forever(() => {
      repeat(20, () => {
        changeVariableBy(vars["Local Glide"], -0.6);
        changeX(vars["Local Glide"]);
      });
      repeat(20, () => {
        changeVariableBy(vars["Local Glide"], 0.6);
        changeX(vars["Local Glide"]);
      });
    });
  });
  ifThen(equals(vars["Local Data"], "2"), () => {
    switchCostumeTo("variant1");
    waitUntil(touching("Hitbox"));
    changeX(60);
    switchCostumeTo("arrow2");
    setVariableTo(vars["Local Glide"], "0");
    goToFrontBack("front");
    repeat(10, () => {
      changeLookEffectBy("ghost", -10);
      changeVariableBy(vars["Local Glide"], 0.6);
      changeY(vars["Local Glide"]);
    });
    forever(() => {
      repeat(20, () => {
        changeVariableBy(vars["Local Glide"], -0.6);
        changeY(vars["Local Glide"]);
      });
      repeat(20, () => {
        changeVariableBy(vars["Local Glide"], 0.6);
        changeY(vars["Local Glide"]);
      });
    });
  });
  ifThen(equals(vars["Local Data"], "3"), () => {
    switchCostumeTo("variant2");
    waitUntil(touching("Hitbox"));
    changeX(20);
    changeY(-10);
    switchCostumeTo("arrow");
    setVariableTo(vars["Local Glide"], "0");
    goToFrontBack("front");
    repeat(10, () => {
      changeLookEffectBy("ghost", -10);
      changeVariableBy(vars["Local Glide"], 0.6);
      changeX(vars["Local Glide"]);
    });
    forever(() => {
      repeat(20, () => {
        changeVariableBy(vars["Local Glide"], -0.6);
        changeX(vars["Local Glide"]);
      });
      repeat(20, () => {
        changeVariableBy(vars["Local Glide"], 0.6);
        changeX(vars["Local Glide"]);
      });
    });
  });
  ifThen(equals(vars["Local Data"], "99"), () => {
    switchCostumeTo("variant1");
    waitUntil(touching("Hitbox"));
    broadcast("win!");
    deleteThisClone();
  });
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
