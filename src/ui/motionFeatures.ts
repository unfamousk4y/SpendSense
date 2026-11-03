// Loaded with a dynamic import (a separate download) after the first screen is
// drawn, so the about-38 kB animation features never delay first paint.
// domMax is the bundle that includes layout animations (layoutId).
import { domMax } from 'motion/react';

export default domMax;
