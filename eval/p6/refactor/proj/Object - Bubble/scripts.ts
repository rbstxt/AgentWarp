// @a1
whenFlagClicked(() => { hide(); });

// @a2
whenStartAsClone(() => {
  setVariableTo(vars["Local VelocityY"], 0);
  goTo("Hitbox");
  changeY(10);
  show();
  changeX(random(-4, 4));
  repeatUntil(not(touching("Object - Water")), () => {
    changeY(10);
    ifElse(touching("Object - Water"), () => { changeY(-10); }, () => { deleteThisClone(); });
    changeY(vars["Local VelocityY"]);
    changeVariableBy(vars["Local VelocityY"], 0.1);
    ifThen(greaterThan(yPosition(), "171"), () => { deleteThisClone(); });
  });
  deleteThisClone();
});

// @a3
whenBroadcastReceived("next", () => { deleteThisClone(); });
