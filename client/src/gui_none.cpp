// 没有编译 GUI 时的占位实现
#include "gui.h"

#include <iostream>

namespace cs {

bool gui_available() { return false; }

int gui_main(int, char **) {
    std::cerr << "此版本没有编译 GUI。请用 --help 查看命令，或用 -DCS_BUILD_GUI=ON 重新构建。\n";
    return 2;
}

} // namespace cs
