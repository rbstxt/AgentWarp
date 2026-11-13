// @a1
whenFlagClicked(() => {
  hideVariable(vars.TimeFinal);
  hide();
});

// @a2
whenBroadcastReceived("mainmenu", () => {
  repeat(26, () => {});
  switchCostumeTo("indesign1");
  goToXY(-20, 129);
  changeX(6);
  changeY(-6);
  setLookEffectTo("brightness", -50);
  createCloneOf("_myself_");
  changeX(-6);
  changeY(6);
  clearGraphicEffects();
  createCloneOf("_myself_");
  repeat(20, () => {});
  goToXY(60, 81);
  switchCostumeTo("indesign2");
  changeX(3);
  changeY(-3);
  setLookEffectTo("brightness", -50);
  createCloneOf("_myself_");
  changeX(-3);
  changeY(3);
  clearGraphicEffects();
  createCloneOf("_myself_");
  repeat(35, () => {});
  goToXY(0, -166);
  goToFrontBack("front");
  switchCostumeTo("indesign3");
  changeX(3);
  changeY(-3);
  setLookEffectTo("brightness", -100);
  setVariableTo(vars["Local Glide"], 0);
  createCloneOf("_myself_");
  changeX(-3);
  changeY(3);
  clearGraphicEffects();
  setVariableTo(vars["Local Glide"], "1");
  createCloneOf("_myself_");
});

// @a3
whenBroadcastReceived("enter game", () => { deleteThisClone(); });

// @a4
whenBroadcastReceived("gameend", () => {
  goToXY(0, -166);
  wait(3);
  setLookEffectTo("ghost", 100);
  switchCostumeTo("ct");
  show();
  repeat(20, () => { changeLookEffectBy("ghost", -5); });
  setVariableTo(vars._AdvanceInputState, "1");
  setVariableTo(vars._CanAdvance, "-120");
  repeatUntil(greaterThan(vars._CanAdvance, "0"), () => {
    call("Advance if any key is pressed");
    changeVariableBy(vars._CanAdvance, "1");
  });
  repeat(20, () => { changeLookEffectBy("ghost", 5); });
  switchCostumeTo("ct4");
  repeat(20, () => { changeLookEffectBy("ghost", -5); });
  setVariableTo(vars._CanAdvance, "-180");
  repeatUntil(greaterThan(vars._CanAdvance, "0"), () => {
    call("Advance if any key is pressed");
    changeVariableBy(vars._CanAdvance, "1");
  });
  repeat(20, () => { changeLookEffectBy("ghost", 5); });
  switchCostumeTo("ct2");
  repeat(20, () => { changeLookEffectBy("ghost", -5); });
  startSound("aplausses");
  setVariableTo(vars._CanAdvance, "-120");
  repeatUntil(greaterThan(vars._CanAdvance, "0"), () => {
    call("Advance if any key is pressed");
    changeVariableBy(vars._CanAdvance, "1");
  });
  repeat(20, () => { changeLookEffectBy("ghost", 5); });
  switchCostumeTo("ct3");
  repeat(20, () => { changeLookEffectBy("ghost", -5); });
  showVariable(vars.TimeFinal);
  setVariableTo(vars.TimeFinal, divide(round(multiply(divide(vars.Time, "30"), "10")), "10"));
  createCloneOf("_myself_");
});

// @a5
script(() => {
  // @c1
  //- Fix lost evidence of clear time
  //-
  //- 2026-08-15 11:58 AM (GMT+7)
  setVariableTo(vars.Time, round(divide(vars.Time, 30)));
  showVariable(vars.Time);
});

// @a6
whenStartAsClone(() => {
  ifThen(equals(costumeNumberName("number"), "3"), () => {
    waitUntil(not(or(mouseDown(), keyPressed("space"))));
    waitUntil(or(mouseDown(), keyPressed("space")));
    block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
    setLookEffectTo("ghost", 0);
    ifThen(equals(vars["Local Glide"], "1"), () => { startSound("Click"); });
    repeat(10, () => {
      hide();
      wait(0);
      show();
    });
    ifThen(equals(vars["Local Glide"], "1"), () => {
      broadcast("fadeblack");
      repeat(20, () => {});
      broadcast("deletecc");
      broadcast("enter game");
    });
    stop("this script");
  });
});

// @a7
whenStartAsClone(() => {
  ifThen(equals(costumeNumberName("number"), "7"), () => {
    setLookEffectTo("ghost", 0);
    repeat(20, () => {
      goToFrontBack("front");
      changeLookEffectBy("ghost", 5);
    });
    deleteThisClone();
  });
  ifThen(equals(costumeNumberName("number"), "3"), () => {
    show();
    forever(() => {
      repeat(10, () => {});
      setLookEffectTo("ghost", 0);
      repeat(10, () => {});
      setLookEffectTo("ghost", 75);
    });
  });
  goToFrontBack("front");
  setLookEffectTo("ghost", 100);
  changeX(-76);
  changeY(-76);
  show();
  setVariableTo(vars["Local Glide"], "4");
  repeat("40", () => {
    changeX(vars["Local Glide"]);
    changeY(vars["Local Glide"]);
    changeVariableBy(vars["Local Glide"], "-0.1");
    changeLookEffectBy("ghost", -5);
  });
});

// @a8
define("Advance if any key is pressed", () => {
    turnRight("0");
    ifElse(or(mouseDown(), keyPressed("space")), () => {
      ifThen(equals(vars._AdvanceInputState, "0"), () => { setVariableTo(vars._CanAdvance, "1"); });
      setVariableTo(vars._AdvanceInputState, "1");
    }, () => { setVariableTo(vars._AdvanceInputState, "0"); });
  });
