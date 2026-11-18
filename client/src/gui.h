#pragma once

namespace cs {
/** 当前构建是否带 GUI */
bool gui_available();

/** GUI 入口；返回进程退出码。未编译 GUI 时返回 2 并给出提示。 */
int gui_main(int argc, char **argv);
}
