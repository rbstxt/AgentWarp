// @a1
whenBroadcastReceived("イントロ完", () => {
  wait("1");
  resetTimer();
  setVariableTo(vars.TIME, "0");
  repeatUntil(equals(vars.ステージ数, "20"), () => {
    repeatUntil(lessThan("1", timer()), () => { ifThen(equals(vars.ステージ数, "20"), () => { block("control_stop", { fields: { "STOP_OPTION": "this script" }, mutation: {"tagName":"mutation","children":[],"hasnext":"false"} }); }); });
    changeVariableBy(vars.TIME, "1");
    resetTimer();
  });
});

// @a2
whenFlagClicked(() => {
  setVariableTo(vars.ステージ数, "1");
  hide();
});

// @a3
whenBroadcastReceived("次のステージ", () => {
  wait("1");
  changeVariableBy(vars.ステージ数, "1");
});

// @a4
whenFlagClicked(() => {
  hideVariable(vars["☁ World record"]);
  hideVariable(vars.TIME);
});

// @a5
whenBroadcastReceived("イントロ完", () => {
  wait("1");
  forever(() => {
    ifElse(equals(vars.ステージ数, "20"), () => {
      ifThen(lessThan(vars.TIME, vars["☁ World record"]), () => { setVariableTo(vars["☁ World record"], vars.TIME); });
      wait("1");
      showVariable(vars["☁ World record"]);
      showVariable(vars.TIME);
      block("control_stop", { fields: { "STOP_OPTION": "this script" }, mutation: {"tagName":"mutation","children":[],"hasnext":"false"} });
    }, () => {
      hideVariable(vars.TIME);
      hideVariable(vars["☁ World record"]);
    });
  });
});

// @a6
whenBroadcastReceived("イントロ完", () => {
  show();
  forever(() => { switchCostumeTo(vars.ステージ数); });
});

// @a7
whenBroadcastReceived("イントロ完", () => {
  goToXY("0", "-75");
  repeat("50", () => { changeY(divide(subtract("0", yPosition()), "5")); });
});

// Per-level timer: seconds since green flag, shown as a monitor and reset
// every time a level starts (green flag for level 1, 次のステージ after).
whenFlagClicked(() => {
  setVariableTo(vars.タイム, "0");
  showVariable(vars.タイム);
  forever(() => {
    wait("1");
    changeVariableBy(vars.タイム, "1");
  });
});

// Level restart: back to zero for the new level.
whenBroadcastReceived("次のステージ", () => {
  setVariableTo(vars.タイム, "0");
});
