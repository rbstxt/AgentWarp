// @a1
whenFlagClicked(() => {});

// @a2
script(() => {
  // @c1
  // I feel so sad to remove this but new one is better and also faster. :)
  broadcast("dev");
});

// @a3
whenBroadcastReceived("dev", () => {
  setSizeTo(200);
  switchCostumeTo("letter1");
  goToXY(-77, 21);
  // @c2
  //- F i r s t j e c t  -  9 letters
  setVariableTo(vars["Local Data"], "0");
  setVariableTo(vars["Local Wait"], "3");
  call("4Dir");
  call("wait %n", vars["Local Wait"]);
  changeX(23);
  nextCostume();
  call("4Dir");
  call("wait %n", vars["Local Wait"]);
  changeX(12);
  nextCostume();
  call("4Dir");
  call("wait %n", vars["Local Wait"]);
  changeX(16);
  nextCostume();
  call("4Dir");
  call("wait %n", vars["Local Wait"]);
  changeX(18);
  nextCostume();
  call("4Dir");
  call("wait %n", vars["Local Wait"]);
  changeX(16);
  nextCostume();
  call("4Dir");
  call("wait %n", vars["Local Wait"]);
  changeX(12);
  nextCostume();
  call("4Dir");
  call("wait %n", vars["Local Wait"]);
  changeX(16);
  nextCostume();
  call("4Dir");
  call("wait %n", vars["Local Wait"]);
  changeX(15);
  nextCostume();
  call("4Dir");
  call("wait %n", vars["Local Wait"]);
  // @c3
  //- presents
  goToXY(20, -10);
  setSizeTo(100);
  nextCostume();
  call("4Dir");
  call("wait %n", vars["Local Wait"]);
  changeX(10);
  nextCostume();
  call("4Dir");
  call("wait %n", vars["Local Wait"]);
  changeX(8);
  nextCostume();
  call("4Dir");
  call("wait %n", vars["Local Wait"]);
  changeX(8);
  nextCostume();
  call("4Dir");
  call("wait %n", vars["Local Wait"]);
  changeX(8);
  nextCostume();
  call("4Dir");
  call("wait %n", vars["Local Wait"]);
  changeX(8);
  nextCostume();
  call("4Dir");
  call("wait %n", vars["Local Wait"]);
  changeX(8);
  nextCostume();
  call("4Dir");
  call("wait %n", vars["Local Wait"]);
  changeX(8);
  nextCostume();
  call("4Dir");
  call("wait %n", vars["Local Wait"]);
  wait(3);
  broadcast("fadeblack - fast");
  repeat(19, () => {});
  hide();
  clearGraphicEffects();
  broadcast("mainmenu");
  deleteOfList("all", lists["Spawn Area X,Y"]);
  deleteOfList("all", lists["Spawn Type"]);
  deleteThisClone();
});

// @a4
whenBroadcastReceived("mainmenu", () => { deleteThisClone(); });

// @a5
define("wait %n", (Tick = 1) => {
    repeat(Tick, () => {});
  });

// @a6
define("FadeAway", () => {
    repeat(10, () => {});
    repeat(10, () => { changeLookEffectBy("ghost", 10); });
    deleteThisClone();
  });

// @a7
define("4Dir", { warp: true }, () => {
    repeat(4, () => {
      changeVariableBy(vars["Local Data"], 1);
      createCloneOf("_myself_");
    });
    setVariableTo(vars["Local Data"], 0);
  });

// @a8
whenStartAsClone(() => {
  ifThen(equals(vars["Local Data"], "1"), () => {
    show();
    setLookEffectTo("ghost", 100);
    setVariableTo(vars["Local Data"], "2");
    changeX(-41);
    repeat(44, () => {
      changeLookEffectBy("ghost", -3);
      changeX(vars["Local Data"]);
      changeVariableBy(vars["Local Data"], -0.05);
    });
    call("FadeAway");
  });
  ifThen(equals(vars["Local Data"], "2"), () => {
    show();
    setLookEffectTo("ghost", 100);
    setVariableTo(vars["Local Data"], "-2");
    changeX(42);
    repeat(44, () => {
      changeLookEffectBy("ghost", -3);
      changeX(vars["Local Data"]);
      changeVariableBy(vars["Local Data"], 0.05);
    });
    call("FadeAway");
  });
  ifThen(equals(vars["Local Data"], "3"), () => {
    show();
    setLookEffectTo("ghost", 100);
    changeY(42);
    setVariableTo(vars["Local Data"], "-2");
    repeat(44, () => {
      changeLookEffectBy("ghost", -3);
      changeY(vars["Local Data"]);
      changeVariableBy(vars["Local Data"], 0.05);
    });
    call("FadeAway");
  });
  ifThen(equals(vars["Local Data"], "4"), () => {
    show();
    setLookEffectTo("ghost", 100);
    changeY(-41);
    setVariableTo(vars["Local Data"], "2");
    repeat(44, () => {
      changeLookEffectBy("ghost", -3);
      changeY(vars["Local Data"]);
      changeVariableBy(vars["Local Data"], -0.05);
    });
  });
});
