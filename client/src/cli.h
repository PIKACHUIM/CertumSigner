#pragma once

namespace cs {

int cli_main(int argc, char **argv);

/**
 * 这次启动是否走图形界面：无参数（双击）、把文件拖到 exe 上、或显式 --gui。
 * main.cpp 用它决定要不要接管父控制台（GUI 模式不接管，避免闪出黑框）。
 */
bool gui_invocation(int argc, char **argv);

} // namespace cs
