// @a1
whenFlagClicked(() => {
  setVariableTo(vars.Data, 0);
  setVariableTo(vars["Local Type"], "1");
  hide();
});

// @a2
whenBroadcastReceived("mainmenu", () => {
  switchCostumeTo("Sign");
  goToXY(-108, -88);
  goForwardBackwardLayers("backward", 9999);
  show();
});

// @a3
whenBroadcastReceived("enter game", () => { hide(); });

// @a4
whenStartAsClone(() => {
  ifThen(equals(vars["Local Type"], "1"), () => {
    call("QuickDelete");
    show();
    setSizeTo(100);
    switchCostumeTo("Sign");
    call("FirstSign?");
    forever(() => {
      waitUntil(touching("Hitbox"));
      setVariableTo(vars["Local Type"], "2");
      createCloneOf("_myself_");
      setVariableTo(vars["Player readingText?"], "1");
      waitUntil(not(touching("Hitbox")));
      setVariableTo(vars["Player readingText?"], 0);
    });
  });
  ifThen(equals(vars["Local Type"], "2"), () => {
    changeY(35);
    ifThen(lessThan(xPosition(), "-94"), () => { setX(-94); });
    setLookEffectTo("ghost", 100);
    call("CheckData");
    setSizeTo(20);
    goToFrontBack("front");
    startSound("SYS-CANSEL");
    repeat(4, () => {
      changeSizeBy(20);
      changeLookEffectBy("ghost", -25);
      call("Still there?");
    });
    repeat(2, () => {
      changeSizeBy(-5);
      call("Still there?");
      wait(0);
      changeSizeBy(5);
      call("Still there?");
    });
    setVariableTo(vars["Local Type"], "3");
    createCloneOf("_myself_");
    forever(() => { call("Still there?"); });
  });
  ifThen(equals(vars["Local Type"], "3"), () => {
    setLookEffectTo("ghost", 100);
    switchCostumeTo(add(vars["Local Data"], 3));
    changeY(-10);
    goToFrontBack("front");
    repeat(5, () => {
      changeLookEffectBy("ghost", -20);
      call("Still there?");
      changeY(2);
    });
    forever(() => { call("Still there?"); });
  });
});

// @a5
whenBroadcastReceived("done", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  deleteThisClone();
});

// @a6
whenBroadcastReceived("next", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  deleteThisClone();
});

// @a7
define("QuickDelete", { warp: true }, () => {
    goToXY(itemOfList(1, lists["Spawn Area X,Y"]), itemOfList(2, lists["Spawn Area X,Y"]));
    deleteOfList(1, lists["Spawn Area X,Y"]);
    deleteOfList(1, lists["Spawn Area X,Y"]);
    setVariableTo(vars["Local Data"], itemOfList(1, lists["Spawn Type"]));
    deleteOfList(1, lists["Spawn Type"]);
  });

// @a8
define("Still there?", () => {
    ifThen(equals(vars["Player readingText?"], "0"), () => {
      startSound("SYS-CLOSE");
      repeat(10, () => {
        changeLookEffectBy("ghost", 10);
        changeSizeBy(-10);
      });
      deleteThisClone();
    });
  });

// @a9
define("CheckData", () => {
    ifThen(equals(vars["Local Data"], "1"), () => { switchCostumeTo("SpeechBB 1"); });
    ifThen(equals(vars["Local Data"], "2"), () => { switchCostumeTo("SpeechBB 2"); });
    ifThen(equals(vars["Local Data"], "3"), () => { switchCostumeTo("SpeechBB 2"); });
    ifThen(equals(vars["Local Data"], "4"), () => { switchCostumeTo("SpeechBB 2"); });
    ifThen(greaterThan(vars["Local Data"], "4"), () => { switchCostumeTo("SpeechBB 2"); });
  });

// @a10
define("FirstSign?", () => {
    ifThen(equals(vars["Local Data"], "1"), () => { repeat(95, () => {}); });
  });
