// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMintableToken {
    function mint(address to, uint256 amount) external;
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// A minimal ERC-4626 vault for local development and tests. It holds a MockERC20 and has hooks to make its shares
/// worth more (yield), less (a loss) or hard to take out (no liquidity). Not for real money: anyone can call the hooks.
contract MockVault {
    address public immutable asset;
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    uint256 private _assets; // what the shares are worth, not counting yield that has not been added yet
    uint256 public ratePerYearBps; // yield per year, as basis points of the assets
    uint256 public lastAccrual;
    uint256 public liquidity = type(uint256).max; // the most a single withdraw or redeem can take out
    // Ways to misbehave, for tests of the escrow's safety checks
    uint256 public depositHaircut; // a deposit is credited this much less than was sent
    uint256 public pullShort; // a deposit pulls this much less than it is credited
    uint256 public withdrawHaircut; // a withdraw sends this much less than asked

    constructor(address _asset) {
        asset = _asset;
        lastAccrual = block.timestamp;
    }

    // ---------------------------------------------------------------- ERC-4626

    function totalAssets() public view returns (uint256) {
        return _assets + _pending();
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return totalSupply == 0 ? assets : (assets * totalSupply) / totalAssets();
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return totalSupply == 0 ? shares : (shares * totalAssets()) / totalSupply;
    }

    function previewRedeem(uint256 shares) external view returns (uint256) {
        return convertToAssets(shares);
    }

    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        _accrue();
        uint256 credited = assets - depositHaircut;
        shares = convertToShares(credited);
        require(IMintableToken(asset).transferFrom(msg.sender, address(this), assets - pullShort), "pull failed");
        _assets += credited;
        totalSupply += shares;
        balanceOf[receiver] += shares;
    }

    /// Takes out exactly `assets`, and burns the shares they are worth, rounded up like the standard says.
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares) {
        require(msg.sender == owner, "owner only");
        require(assets <= liquidity, "no liquidity");
        _accrue();
        shares = totalSupply == 0 ? 0 : (assets * totalSupply + _assets - 1) / _assets;
        _burn(owner, shares);
        _assets -= assets;
        require(IMintableToken(asset).transfer(receiver, assets - withdrawHaircut), "send failed");
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        require(msg.sender == owner, "owner only");
        _accrue();
        assets = convertToAssets(shares);
        require(assets <= liquidity, "no liquidity");
        _burn(owner, shares);
        _assets -= assets;
        require(IMintableToken(asset).transfer(receiver, assets), "send failed");
    }

    // ---------------------------------------------------------------- hooks for tests and demos

    /// Makes the shares worth `amount` more. The asset must be a MockERC20, which anyone can mint.
    function accrueYield(uint256 amount) external {
        _accrue();
        IMintableToken(asset).mint(address(this), amount);
        _assets += amount;
    }

    /// Yield that builds up with time, as basis points per year, so a demo shows it growing.
    function setRatePerYear(uint256 bps) external {
        _accrue();
        ratePerYearBps = bps;
    }

    /// Makes the shares worth `amount` less.
    function simulateLoss(uint256 amount) external {
        _accrue();
        _assets -= amount;
        require(IMintableToken(asset).transfer(address(0xdead), amount), "send failed");
    }

    /// The most that a single withdraw or redeem can take out. Use type(uint256).max to lift the limit.
    function setLiquidity(uint256 max) external {
        liquidity = max;
    }

    function setDepositHaircut(uint256 amount) external {
        depositHaircut = amount;
    }

    function setPullShort(uint256 amount) external {
        pullShort = amount;
    }

    function setWithdrawHaircut(uint256 amount) external {
        withdrawHaircut = amount;
    }

    // ---------------------------------------------------------------- internals

    function _pending() private view returns (uint256) {
        return (_assets * ratePerYearBps * (block.timestamp - lastAccrual)) / (10_000 * 365 days);
    }

    function _accrue() private {
        uint256 gain = _pending();
        lastAccrual = block.timestamp;
        if (gain > 0) {
            IMintableToken(asset).mint(address(this), gain);
            _assets += gain;
        }
    }

    function _burn(address from, uint256 shares) private {
        require(balanceOf[from] >= shares, "shares");
        balanceOf[from] -= shares;
        totalSupply -= shares;
    }
}
