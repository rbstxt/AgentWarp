// @a1
whenFlagClicked(() => {
  setVariableTo(vars["Local Type"], "1");
  hide();
});

// @a2
whenStartAsClone(() => {
  ifThen(equals(vars["Local Type"], "1"), () => {
    goTo("Hitbox");
    setVariableTo(vars["Local Type"], "2");
    setLookEffectTo("ghost", 75);
    createCloneOf("_myself_");
    createCloneOf("_myself_");
    createCloneOf("_myself_");
    createCloneOf("_myself_");
    createCloneOf("_myself_");
  });
  ifThen(equals(vars["Local Type"], "2"), () => {
    show();
    changeY(-16);
    changeX(random(-6, 6));
    switchCostumeTo("variant 1");
    setVariableTo(vars["Local GlideX"], random(3, -3.001));
    setVariableTo(vars["Local GlideY"], random(6, 0.5));
    repeat(60, () => {
      changeX(vars["Local GlideX"]);
      changeY(vars["Local GlideY"]);
      changeVariableBy(vars["Local GlideY"], -0.35);
      changeSizeBy(-1);
      ifThen(touching("_edge_"), () => { deleteThisClone(); });
    });
    deleteThisClone();
  });
  deleteThisClone();
});

// @a3
whenBroadcastReceived("next", () => { deleteThisClone(); });
