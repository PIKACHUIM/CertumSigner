cmake_minimum_required(VERSION 3.16)
project(CertumSigner
    VERSION 1.0.0
    DESCRIPTION "Cloud code signing client for Certum SimplySign via Cloudflare Workers"
    HOMEPAGE_URL "https://github.com/PIKACHUIM/CertumSigner"
    LANGUAGES CXX
)
# License: AGPL-3.0-or-later — see ../LICENSE

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(CS_BUILD_GUI "构建图形界面（Windows 用 Win32，Linux 用 GTK3）" ON)

find_package(OpenSSL REQUIRED)
find_package(Threads REQUIRED)

add_executable(certumsigner
    src/main.cpp
    src/cli.cpp
    src/util.cpp
    src/json.cpp
    src/der.cpp
    src/digest.cpp
    src/pe.cpp
    src/spc.cpp
    src/pkcs7.cpp
    src/tsa.cpp
    src/api.cpp
    src/settings.cpp
    src/signer.cpp
    src/scan.cpp
)

target_include_directories(certumsigner PRIVATE src)
target_link_libraries(certumsigner PRIVATE OpenSSL::Crypto Threads::Threads)

if(WIN32)
    target_sources(certumsigner PRIVATE src/http_win.cpp src/signature_info.cpp)
    target_link_libraries(certumsigner PRIVATE winhttp wintrust crypt32)
    target_compile_definitions(certumsigner PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE)
    if(CS_BUILD_GUI)
        target_sources(certumsigner PRIVATE src/gui_win.cpp)
        target_link_libraries(certumsigner PRIVATE comctl32 comdlg32)
        # GUI 子系统：双击不弹控制台窗口。命令行调用时程序自己 AttachConsole 到父控制台
        target_compile_definitions(certumsigner PRIVATE CS_GUI_SUBSYSTEM)
        set_target_properties(certumsigner PROPERTIES WIN32_EXECUTABLE TRUE)
    else()
        target_sources(certumsigner PRIVATE src/gui_none.cpp)
    endif()
else()
    find_package(CURL REQUIRED)
    target_sources(certumsigner PRIVATE src/http_curl.cpp)
    target_link_libraries(certumsigner PRIVATE CURL::libcurl)
    if(CS_BUILD_GUI)
        find_package(PkgConfig REQUIRED)
        pkg_check_modules(GTK3 REQUIRED IMPORTED_TARGET gtk+-3.0)
        target_sources(certumsigner PRIVATE src/gui_gtk.cpp)
        target_link_libraries(certumsigner PRIVATE PkgConfig::GTK3)
    else()
        target_sources(certumsigner PRIVATE src/gui_none.cpp)
    endif()
endif()

if(MSVC)
    # /utf-8：源码里有中文字面量，不加会按本地代码页解释
    target_compile_options(certumsigner PRIVATE /utf-8 /W4 /permissive-)
    target_compile_definitions(certumsigner PRIVATE _CRT_SECURE_NO_WARNINGS WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE)
else()
    target_compile_options(certumsigner PRIVATE -Wall -Wextra -Wno-unused-parameter)
endif()

install(TARGETS certumsigner RUNTIME DESTINATION bin)
