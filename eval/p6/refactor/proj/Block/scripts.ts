// @a1
whenFlagClicked(() => { hide(); });

// @a2
whenBroadcastReceived("mainmenu", () => {
  switchCostumeTo("LightBlock -Normal");
  goToXY(0, -83);
  show();
  setVariableTo(vars["Local BlinkRandom"], "-45");
  forever(() => {
    changeVariableBy(vars["Local BlinkRandom"], 0.5);
    ifThen(equals(vars["Local BlinkRandom"], "222"), () => { setVariableTo(vars["Local BlinkRandom"], 0); });
    ifThen(equals(vars["Local BlinkRandom"], "7"), () => { call("Blink"); });
    ifThen(equals(vars["Local BlinkRandom"], "34"), () => { call("Blink"); });
    ifThen(equals(vars["Local BlinkRandom"], "42"), () => { call("Blink"); });
    ifThen(equals(vars["Local BlinkRandom"], "84"), () => { call("Blink"); });
    ifThen(equals(vars["Local BlinkRandom"], "126"), () => { call("Blink"); });
    ifThen(equals(vars["Local BlinkRandom"], "134"), () => { call("Blink"); });
    ifThen(equals(vars["Local BlinkRandom"], "198"), () => { call("Blink"); });
  });
});

// @a3
whenBroadcastReceived("enter game", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  switchCostumeTo("LightBlock -Normal");
  show();
  setVariableTo(vars["Local BlinkRandom"], "-45");
  forever(() => {
    changeVariableBy(vars["Local BlinkRandom"], 0.5);
    goTo("Hitbox");
    ifThen(equals(vars["Local BlinkRandom"], "222"), () => { setVariableTo(vars["Local BlinkRandom"], 0); });
    ifThen(equals(vars["Local BlinkRandom"], "7"), () => { call("Blink"); });
    ifThen(equals(vars["Local BlinkRandom"], "34"), () => { call("Blink"); });
    ifThen(equals(vars["Local BlinkRandom"], "42"), () => { call("Blink"); });
    ifThen(equals(vars["Local BlinkRandom"], "84"), () => { call("Blink"); });
    ifThen(equals(vars["Local BlinkRandom"], "126"), () => { call("Blink"); });
    ifThen(equals(vars["Local BlinkRandom"], "134"), () => { call("Blink"); });
    ifThen(equals(vars["Local BlinkRandom"], "198"), () => { call("Blink"); });
  });
});

// @a4
define("Blink", () => {
    repeat(5, () => {
      goTo("Hitbox");
      nextCostume();
    });
    repeat(5, () => {
      goTo("Hitbox");
      switchCostumeTo(subtract(costumeNumberName("number"), 1));
    });
  });

// @a5
whenBroadcastReceived("gameend", () => {
  block("control_stop", { fields: { "STOP_OPTION": "other scripts in sprite" }, mutation: {"tagName":"mutation","hasnext":"true","children":[]} });
  hide();
  deleteThisClone();
});
