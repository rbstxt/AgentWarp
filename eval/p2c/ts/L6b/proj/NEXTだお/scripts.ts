// @a1
define("クローン %s", (名前) => {
    switchCostumeTo(名前);
    createCloneOf("_myself_");
  });

// @a2
whenBroadcastReceived("次のステージ", () => {
  hide();
  startSound("High Whoosh");
  call("クローン %s", "1");
  wait("0.15");
  call("クローン %s", "2");
  wait("0.15");
  call("クローン %s", "3");
  wait("0.15");
  call("クローン %s", "next");
  wait("0.45");
  call("クローン %s", "5");
  wait("0.15");
  // @c1
  // ⇧
  // この下に入れてください
  call("クローン %s", "6");
  // @c2
  // この音は共有後に追加したので、付けるかつけないかはあなた次第です！
  startSound("Finger Snap");
  wait("0.15");
  call("クローン %s", "7");
  call("クローン %s", "☆");
  call("クローン %s", "♡");
  call("クローン %s", "👤");
  changeLookEffectBy("COLOR", "15");
});

// @a3
whenFlagClicked(() => { setLookEffectTo("COLOR", random("-200", "200")); });

// @a4
whenStartAsClone(() => {
  ifThen(or(equals(costumeNumberName("name"), "1"), or(equals(costumeNumberName("name"), "2"), or(equals(costumeNumberName("name"), "3"), equals(costumeNumberName("name"), "next")))), () => {
    setLookEffectTo("BRIGHTNESS", "0");
    goToFrontBack("front");
    setX("-465");
    setY("0");
    show();
    repeatUntil(equals(round(xPosition()), "0"), () => { changeX(divide(subtract("0", xPosition()), "4")); });
    wait("0.9");
    deleteThisClone();
  });
  ifThen(or(equals(costumeNumberName("name"), "4"), or(equals(costumeNumberName("name"), "5"), equals(costumeNumberName("name"), "6"))), () => {
    goToFrontBack("front");
    changeLookEffectBy("COLOR", "10");
    setX("0");
    setY("345");
    show();
    repeatUntil(equals(round(yPosition()), "0"), () => { changeY(divide(subtract("0", yPosition()), "4")); });
  });
  ifThen(or(equals(costumeNumberName("name"), "☆"), or(equals(costumeNumberName("name"), "♡"), equals(costumeNumberName("name"), "👤"))), () => {
    setLookEffectTo("COLOR", "0");
    goToFrontBack("front");
    setX("0");
    setY("345");
    show();
    repeatUntil(equals(round(yPosition()), "0"), () => { changeY(divide(subtract("0", yPosition()), "4")); });
  });
  ifThen(equals(costumeNumberName("name"), "4"), () => {
    wait("0.3");
    repeatUntil(lessThan("464", xPosition()), () => { changeX(add("1", divide(xPosition(), "3"))); });
    deleteThisClone();
  });
  ifThen(equals(costumeNumberName("name"), "5"), () => {
    wait("0.2");
    repeatUntil(lessThan("464", xPosition()), () => { changeX(add("1", divide(xPosition(), "3"))); });
    deleteThisClone();
  });
  ifThen(equals(costumeNumberName("name"), "6"), () => {
    wait("0.1");
    repeatUntil(lessThan("464", xPosition()), () => { changeX(add("1", divide(xPosition(), "3"))); });
    deleteThisClone();
  });
  ifThen(equals(costumeNumberName("name"), "♡"), () => {
    wait("0.2");
    repeatUntil(lessThan("319", xPosition()), () => { changeX(add("1", divide(xPosition(), "3"))); });
    deleteThisClone();
  });
  ifThen(equals(costumeNumberName("name"), "👤"), () => {
    wait("0.125");
    repeatUntil(lessThan("360", xPosition()), () => { changeX(add("1", divide(xPosition(), "3"))); });
    deleteThisClone();
  });
  ifThen(equals(costumeNumberName("name"), "☆"), () => {
    wait("0.2");
    repeatUntil(lessThan("185", xPosition()), () => { changeX(add("1", divide(xPosition(), "3"))); });
    deleteThisClone();
  });
});

// @a5
xPosition();
