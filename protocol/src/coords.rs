/// 通用坐标系：与任何UI库解耦，使用u16保证整数精度
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LayoutRect {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}
