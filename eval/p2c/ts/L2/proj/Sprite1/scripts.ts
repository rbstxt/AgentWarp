// L2 cat: arrow keys move 5px per frame.
whenFlagClicked(() => {
  goToXY(0, 0);
  forever(() => {
    ifThen(keyPressed("right arrow"), () => {
      changeX(5);
    });
    ifThen(keyPressed("left arrow"), () => {
      changeX(-5);
    });
    ifThen(keyPressed("up arrow"), () => {
      changeY(5);
    });
    ifThen(keyPressed("down arrow"), () => {
      changeY(-5);
    });
  });
});
