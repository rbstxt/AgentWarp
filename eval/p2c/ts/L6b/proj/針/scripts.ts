// @a1
whenBroadcastReceived("イントロ完", () => {
  show();
  forever(() => {
    switchCostumeTo(vars.ステージ数);
    goToFrontBack("back");
  });
});

// @a2
whenFlagClicked(() => { hide(); });

// @a3
whenBroadcastReceived("イントロ完", () => {
  goToXY("0", "-75");
  repeat("50", () => { changeY(divide(subtract("0", yPosition()), "5")); });
});

// @a4
script(() => {
  setVariableTo(vars.ステージ数, "19");
});
